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

function configure(env: Env): void {
  // Hidrata process.env desde los bindings del Worker para el código que lo lee
  // (jwt, sunat, logger, etc.). Se hace en cada invocación por si el runtime no
  // lo pobló en el scope de módulo.
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && process.env[key] === undefined) {
      process.env[key] = value;
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
      // La app lee su config desde process.env (ya hidratado), no del binding env.
      return await runWithDb(db, () => app.fetch(request));
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
