import { app } from "./app.js";
import { createRequestDb, runWithDb } from "@restai/db";
import { useHasher, useRealtime } from "./infrastructure/container.js";
import { WebCryptoHasher } from "./infrastructure/security/webcrypto.adapter.js";
import { createServerlessRealtimeProvider } from "./infrastructure/realtime/factory.serverless.js";
import { expireStale } from "./services/session.service.js";

/**
 * Entrypoint para Cloudflare Workers (serverless, sin contenedor).
 *
 * Composition root del runtime edge:
 *  - hashing → WebCrypto (sin binarios nativos)
 *  - realtime → Pusher/Ably (sin WebSockets persistentes)
 *  - DB → conexión Neon POR-REQUEST (Workers aísla el I/O por petición), envuelta
 *    en `runWithDb` para que toda la app (incl. sus transacciones) la use.
 *  - crons → Cron Triggers (`scheduled`), en vez de setInterval.
 */

interface Env {
  DATABASE_URL: string;
  [key: string]: string | undefined;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

let configured = false;

// Claves que la app lee vía process.env. Se copian explícitamente desde los
// bindings del Worker porque éstos NO se enumeran con Object.entries(env).
// (Además del flag nodejs_compat_populate_process_env, como doble seguridad.)
const ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_DRIVER",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "SUNAT_ENCRYPTION_KEY",
  "REALTIME_PROVIDER",
  "ABLY_API_KEY",
  "PUSHER_APP_ID",
  "PUSHER_KEY",
  "PUSHER_SECRET",
  "PUSHER_CLUSTER",
  "LOG_LEVEL",
  "CORS_ORIGINS",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
] as const;

function configure(env: Env): void {
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value !== "") {
      try {
        process.env[key] = value;
      } catch {
        // process.env podría ser de solo lectura según el runtime; lo ignoramos.
      }
    }
  }
  if (configured) return;
  useHasher(new WebCryptoHasher());
  useRealtime(createServerlessRealtimeProvider());
  configured = true;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    configure(env);
    const { db, close } = await createRequestDb(env.DATABASE_URL);
    try {
      // Pasamos env a Hono (c.env) además de hidratar process.env.
      return await runWithDb(db, () => app.fetch(request, env as never));
    } finally {
      // Cierra la conexión tras responder sin bloquear la respuesta.
      ctx.waitUntil(close());
    }
  },

  // Cron Trigger: reemplaza el setInterval de expiración de sesiones del contenedor.
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    configure(env);
    ctx.waitUntil(
      (async () => {
        const { db, close } = await createRequestDb(env.DATABASE_URL);
        try {
          await runWithDb(db, () => expireStale());
        } finally {
          await close();
        }
      })(),
    );
  },
};
