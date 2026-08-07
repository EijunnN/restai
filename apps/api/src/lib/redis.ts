import Redis from "ioredis";
import { logger } from "./logger.js";

// Mismo patrón de detección de Workers que en packages/db/src/index.ts.
const isWorkers =
  typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== "undefined" ||
  (typeof navigator !== "undefined" &&
    (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

/**
 * Reconexión SIN tope de intentos.
 *
 * Antes se devolvía `null` a partir del intento 21, que en ioredis significa
 * "no reintentes nunca más": una caída de Redis de poco más de un minuto (la
 * suma de los 20 backoffs) dejaba el proceso desconectado PARA SIEMPRE aunque
 * Redis volviese. El daño no era el rate limiter —que degrada solo a memoria—
 * sino el pub/sub del WebSocket: con varias réplicas, los pedidos publicados en
 * la instancia A dejaban de llegar a la pantalla de cocina conectada a la B, en
 * silencio y sin que nada lo delatara.
 *
 * El backoff acotado (máx. 5 s) ya evita el martilleo; no hace falta rendirse.
 * El log se emite de forma espaciada para no inundar la salida durante una
 * caída larga.
 */
const retryStrategy = (times: number) => {
  if (times === 1 || times % 20 === 0) {
    logger.warn("Redis reconnecting", { attempts: times });
  }
  return Math.min(times * 200, 5000);
};

// Cloudflare Workers no soporta conexiones TCP: ioredis colgaría el request y
// contaminaría I/O pendiente en el scope del módulo (shared entre requests),
// lo que hace que workerd cancele los requests siguientes con el error
// "Worker hung and would never generate a response" (aparece como 1101).
// El noop rechaza inmediatamente → el fallback in-memory del rate limiter entra
// sin ningún delay, y el Worker nunca intenta TCP.
let _redis: Redis;

if (isWorkers) {
  const unavailable = () =>
    Promise.reject(new Error("Redis unavailable in Cloudflare Workers"));
  _redis = {
    incr: unavailable,
    expire: unavailable,
    pttl: unavailable,
    ping: unavailable,
    get: unavailable,
    set: unavailable,
    del: unavailable,
    quit: () => Promise.resolve("OK" as "OK"),
    status: "end" as Redis["status"],
    on: (_event: string, _handler: unknown) => _redis,
    off: (_event: string, _handler: unknown) => _redis,
    disconnect: () => {},
  } as unknown as Redis;
} else {
  _redis = new Redis(REDIS_URL, {
    retryStrategy,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  _redis.on("error", (err) => {
    logger.error("Redis connection error", { error: err.message });
  });
  _redis.on("connect", () => {
    logger.info("Redis connected");
  });
}

export const redis = _redis;

export const createSubscriber = (): Redis => {
  if (isWorkers) {
    throw new Error("Redis pub/sub not available in Cloudflare Workers");
  }
  const sub = new Redis(REDIS_URL, {
    retryStrategy,
    maxRetriesPerRequest: null,
  });
  sub.on("error", (err) => {
    logger.error("Redis subscriber error", { error: err.message });
  });
  return sub;
};

/** ¿Este runtime puede hablar con Redis? (Workers no: no hay sockets TCP). */
export const redisSupported = !isWorkers;

/**
 * Sonda activa de Redis para /health.
 *
 * Acotada en el tiempo a propósito: /health tiene que responder aunque Redis
 * esté caído y la conexión siga en su ciclo de reconexión, porque con
 * `lazyConnect` el PING encolado esperaría al próximo intento con éxito.
 */
export async function getRedisStatus(timeoutMs = 1500): Promise<"ok" | "error"> {
  if (isWorkers) return "error";
  // El temporizador se limpia siempre: /health se sondea cada 10 s desde el
  // healthcheck del contenedor y no tiene sentido dejar timers colgando cuando
  // el PING responde de inmediato (que es el caso normal).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pong = await Promise.race([
      _redis.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Redis ping timeout")), timeoutMs);
      }),
    ]);
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
