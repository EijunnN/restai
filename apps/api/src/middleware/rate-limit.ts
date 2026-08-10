import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { redis, intentarRedis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { verifyAccessToken } from "../lib/jwt.js";

/**
 * Limitador de peticiones por ventana fija.
 *
 * ── Por qué la clave NO puede ser solo la IP ────────────────────────────────
 * En un restaurante TODO sale por la misma IP pública: las tablets del salón,
 * la caja, la pantalla de cocina y —si están en el WiFi del local— los móviles
 * de los comensales. Con un cubo único por IP, un viernes lleno el propio local
 * se autoinflige un 429 justo en la hora punta: /orders sondea cada 5 s (12
 * req/min por pestaña) y la campana de avisos cada 20 s (3 req/min), así que
 * cinco tablets abiertas ya se comen el cubo entero sin que nadie haga nada raro.
 *
 * La clave se compone ahora con la IDENTIDAD cuando la petición viene firmada:
 *   - staff autenticado         → `u:<user.sub>`
 *   - comensal con sesión/cuenta→ `c:<sub>`  (sesión de mesa o token de cuenta)
 *   - anónimo                   → `ip:<ip>`
 *
 * La IP se sigue usando —y es lo correcto— en los caminos PÚBLICOS sin token
 * (login, entrada del comensal por código de mesa), que es donde el cubo por IP
 * hace su trabajo real: frenar la fuerza bruta. Un atacante no puede fabricar
 * una identidad porque el token se VERIFICA aquí (firma + exp); un token
 * inválido o caducado no crea cubo propio, cae al de su IP.
 *
 * Y en los cubos que existen SOLO para frenar la fuerza bruta contra endpoints
 * no autenticados, la identidad se ignora por completo aunque el token sea
 * válido: ver {@link IP_ONLY_PREFIXES}.
 *
 * El tope de las peticiones autenticadas se separa del anónimo: como la clave ya
 * es individual, el presupuesto puede ser mucho más holgado sin abrir la puerta
 * a nadie (por defecto ×6 el anónimo; ver AUTH_FACTOR).
 *
 * ── Coste ───────────────────────────────────────────────────────────────────
 * Verificar el JWT aquí es un HMAC-SHA256 (microsegundos) y el resultado se
 * memoiza por petición, así que los dos limitadores que se apilan en
 * /api/customer/* (global + customer) solo verifican una vez.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory fallback used only when Redis is unavailable.
const store = new Map<string, RateLimitEntry>();

// Poda oportunista (sin setInterval global, que no es válido en Cloudflare Workers).
// Se limpian las entradas vencidas como mucho una vez por minuto, en el flujo de un request.
let lastPrune = 0;
const PRUNE_INTERVAL_MS = 60_000;
function prune(now: number) {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

// X-Forwarded-For is client-controlled and trivially spoofable. Only honor it
// when we are explicitly told we sit behind a trusted reverse proxy
// (docker-compose runs behind Traefik). Otherwise we key on a non-spoofable
// value (the socket remote address) so an attacker can't forge a fresh bucket
// per request.
//
// Se lee de forma PEREZOSA: en Cloudflare Workers `process.env` se hidrata en
// worker.ts → configure(), que corre DESPUÉS de importar los módulos. Leerlo en
// el scope del módulo dejaba TRUST_PROXY siempre en false en ese runtime.
let trustProxyCache: boolean | null = null;
function trustProxy(): boolean {
  if (trustProxyCache === null) {
    trustProxyCache = process.env.TRUST_PROXY === "true";
  }
  return trustProxyCache;
}

// Bun's server is passed to Hono as the second `fetch` arg and surfaced on
// `c.env`. It exposes requestIP(req) -> { address } for the real socket peer.
type BunServerEnv = { requestIP?: (req: Request) => { address?: string } | null };

function clientIp(c: Context): string {
  if (trustProxy()) {
    const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (xff) return xff;
    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp;
  }

  // Non-spoofable fallback: the actual socket peer address from the Bun server.
  // (Behind an untrusted proxy this collapses everyone to the proxy IP, which is
  // the safe failure mode — we never trust attacker-supplied headers.)
  const server = c.env as BunServerEnv | undefined;
  const addr = server?.requestIP?.(c.req.raw)?.address;
  return addr || "unknown";
}

interface RateLimitIdentity {
  /** Componente identificador de la clave del cubo. */
  id: string;
  /** true solo si el token venía firmado y VERIFICADO. */
  authenticated: boolean;
}

// Memoización por petición: la misma Request pasa por varios limitadores
// apilados (global + auth/customer) y no tiene sentido verificar el JWT dos
// veces. WeakMap sobre el Request crudo → se libera con la petición.
const identityCache = new WeakMap<Request, Promise<RateLimitIdentity>>();

async function computeIdentity(c: Context): Promise<RateLimitIdentity> {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token) {
      try {
        const payload = (await verifyAccessToken(token)) as {
          sub?: unknown;
          role?: unknown;
        };
        if (typeof payload.sub === "string" && payload.sub) {
          // `c:` para comensales (sub = id de sesión de mesa o del cliente),
          // `u:` para personal (sub = id de usuario). El prefijo evita que un
          // id de sesión y uno de usuario compartan cubo por colisión.
          const scope = payload.role === "customer" ? "c" : "u";
          return { id: `${scope}:${payload.sub}`, authenticated: true };
        }
      } catch {
        // Token inválido, caducado o secreto no configurado: NO es una
        // identidad. Cae al cubo de su IP, que es lo que frena la fuerza bruta.
      }
    }
  }
  return { id: `ip:${clientIp(c)}`, authenticated: false };
}

function resolveIdentity(c: Context): Promise<RateLimitIdentity> {
  const raw = c.req.raw;
  const cached = identityCache.get(raw);
  if (cached) return cached;
  const pending = computeIdentity(c);
  identityCache.set(raw, pending);
  return pending;
}

interface CounterResult {
  count: number;
  resetAt: number;
}

/**
 * Atomically increment the counter for `key` within a fixed window. Backed by
 * Redis (INCR + EXPIRE) so limits hold across instances; falls back to the
 * in-memory Map if Redis is unavailable.
 */
/** Contador en memoria. Es el plan B, y tambien el camino con Redis caido. */
function contarEnMemoria(key: string, windowMs: number): CounterResult {
  const now = Date.now();
  prune(now);
  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  entry.count++;
  return { count: entry.count, resetAt: entry.resetAt };
}

async function incrementCounter(key: string, windowMs: number): Promise<CounterResult> {
  const windowSec = Math.ceil(windowMs / 1000);

  /*
    `intentarRedis` no puede bloquear: si Redis no responde devuelve null
    enseguida y se cuenta en memoria. Aceptar memoria relaja el limite —cada
    instancia cuenta por su cuenta— y es la eleccion correcta: el limitador
    existe para que un abuso no tumbe el local, no para tumbarlo el mismo cuando
    falla la cache.
  */
  const resultado = await intentarRedis(async () => {
    // INCR returns the new count; on the first hit (count === 1) we set the TTL.
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }
    let ttl = await redis.pttl(key);
    // PTTL returns -1 (no expiry) or -2 (no key) in edge/race cases; reassert TTL.
    if (ttl < 0) {
      await redis.expire(key, windowSec);
      ttl = windowMs;
    }
    return { count, resetAt: Date.now() + ttl };
  });

  return resultado ?? contarEnMemoria(key, windowMs);
}

/**
 * Cuántas veces más holgado es el presupuesto de una identidad autenticada
 * respecto del anónimo. Con la clave por usuario/sesión, el cubo ya no lo
 * comparte todo el local, así que el tope puede subir sin regalar nada:
 * el tope global efectivo pasa de 100 req/min PARA TODO EL LOCAL a 600 req/min
 * POR EMPLEADO (≈ 10 pestañas de /orders sondeando a la vez, con margen).
 * Ajustable con RATE_LIMIT_USER_FACTOR.
 */
const DEFAULT_AUTH_FACTOR = 6;

function envInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface RateLimiterOptions {
  /** Tope para peticiones ANÓNIMAS (clave = IP). Por defecto `maxRequests`. */
  anonymousMax?: number;
  /** Tope para peticiones AUTENTICADAS (clave = identidad). Por defecto `maxRequests * factor`. */
  authenticatedMax?: number;
  /**
   * Ignorar la identidad y keyear SIEMPRE por IP. Ver {@link IP_ONLY_PREFIXES}.
   */
  ipOnly?: boolean;
}

/**
 * Cubos que protegen endpoints NO autenticados y por tanto NUNCA pueden keyearse
 * por identidad.
 *
 * `/api/auth/*` es el cubo que frena la fuerza bruta contra el login. Si
 * presentar un token comprara un cubo propio y más holgado, el freno se
 * evaporaría: basta con adjuntar a cada intento de login un Bearer válido
 * cualquiera —por ejemplo una sesión de comensal, que en una sede con
 * auto-aprobación se obtiene con el código impreso en la mesa y se puede renovar
 * a voluntad— para multiplicar el presupuesto por el factor autenticado y, en el
 * límite, rotar identidades hasta tener intentos ilimitados desde una sola IP.
 *
 * En estos cubos el precio de keyear por IP no se paga: el frontend solo llama a
 * /api/auth/login, /register y /refresh (este último ~1 vez cada 15 min por
 * pestaña), muy lejos del tope incluso con todo el local detrás de una sola IP.
 */
const IP_ONLY_PREFIXES = new Set(["auth"]);

/**
 * @param maxRequests Presupuesto base por ventana (el tope anónimo, por IP).
 * @param windowMs    Ventana fija, en milisegundos.
 * @param prefix      Espacio de nombres del cubo ("global", "auth", "customer").
 *
 * Overrides por entorno, sin redespliegue (PREFIX en mayúsculas):
 *   RATE_LIMIT_<PREFIX>_ANON_MAX   tope anónimo (por IP)
 *   RATE_LIMIT_<PREFIX>_USER_MAX   tope autenticado (por identidad)
 *   RATE_LIMIT_USER_FACTOR         multiplicador por defecto del tope autenticado
 */
export function rateLimiter(
  maxRequests = 100,
  windowMs = 60_000,
  prefix = "global",
  options: RateLimiterOptions = {},
) {
  const envPrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const ipOnly = options.ipOnly ?? IP_ONLY_PREFIXES.has(prefix);

  // Los topes se resuelven en la PRIMERA petición, no al construir el
  // middleware: en Workers process.env aún no está hidratado en ese momento.
  let limits: { anonymous: number; authenticated: number } | null = null;
  function resolveLimits() {
    if (limits) return limits;
    const factor = envInt("RATE_LIMIT_USER_FACTOR") ?? DEFAULT_AUTH_FACTOR;
    const anonymous =
      envInt(`RATE_LIMIT_${envPrefix}_ANON_MAX`) ?? options.anonymousMax ?? maxRequests;
    const authenticated =
      envInt(`RATE_LIMIT_${envPrefix}_USER_MAX`) ??
      options.authenticatedMax ??
      anonymous * factor;
    limits = { anonymous, authenticated };
    return limits;
  }

  return createMiddleware(async (c, next) => {
    // En los cubos ip-only no se verifica el JWT siquiera: no cambiaría nada y
    // ahorra un HMAC por petición.
    const identity: RateLimitIdentity = ipOnly
      ? { id: `ip:${clientIp(c)}`, authenticated: false }
      : await resolveIdentity(c);
    const { anonymous, authenticated } = resolveLimits();
    const limit = identity.authenticated ? authenticated : anonymous;
    const key = `ratelimit:${prefix}:${identity.id}`;

    const { count, resetAt } = await incrementCounter(key, windowMs);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (count > limit) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
      return c.json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "Demasiadas solicitudes, intenta más tarde" },
        },
        429,
      );
    }

    return next();
  });
}
