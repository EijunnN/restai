import { app } from "./app.js";
import { createRequestDb, runWithDb } from "@restai/db";
import { useHasher, useRealtime } from "./infrastructure/container.js";
import { WebCryptoHasher } from "./infrastructure/security/webcrypto.adapter.js";
import { createServerlessRealtimeProvider } from "./infrastructure/realtime/factory.serverless.js";
import { expireStale } from "./services/session.service.js";
import { configureR2Bucket } from "./lib/r2.js";
import { logger } from "./lib/logger.js";
import { runLoyaltyJobs, isLoyaltyDailyWindow } from "./lib/jobs.js";

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

// `R2Bucket`, `ExecutionContext` y `ScheduledController` son globales de
// @cloudflare/workers-types (declarado en apps/api/tsconfig.json). Antes se
// declaraban a mano interfaces mínimas y `R2Bucket` no existía en absoluto, así
// que `tsc --noEmit` fallaba y NADA de la parte específica de Workers quedaba
// comprobada: un cambio que rompiera el contrato de Cloudflare no se veía hasta
// el despliegue.
interface Env {
  DATABASE_URL: string;
  R2_IMAGES?: R2Bucket;
  [key: string]: string | R2Bucket | undefined;
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
  "RESEND_API_KEY",
  "RESEND_FROM",
  "R2_PUBLIC_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
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
    configureR2Bucket(env.R2_IMAGES);
    const { db, close } = await createRequestDb(env.DATABASE_URL);
    try {
      // La app lee su config desde process.env (hidratado en configure()).
      return await runWithDb(db, () => app.fetch(request));
    } finally {
      // Cierra tras responder sin bloquear (patrón recomendado por Neon para
      // Workers). NO usar `await close()`: pool.end() puede colgar en workerd y
      // dejar el request sin responder.
      ctx.waitUntil(close());
    }
  },

  /**
   * Cron Trigger: reemplaza los setInterval del contenedor.
   *
   * El cron declarado en wrangler.toml es de grano fino (cada 5 minutos) porque
   * eso es lo que necesita la expiración de sesiones. Los trabajos de
   * fidelización, en cambio, son DIARIOS: ejecutarlos en cada disparo suponía
   * 288 pasadas al día de `awardBirthdayBonuses` (JOIN de customers ×
   * customer_loyalty × loyalty_programs, más una transacción por candidato) y de
   * `notifyExpiringPoints`, frente a UNA sola en los entrypoints de Bun y Node.
   * Son idempotentes, así que no rompían nada visible: solo quemaban base de
   * datos. Aquí se separan las dos cadencias con la ventana horaria de
   * lib/jobs.ts, sin depender de que wrangler declare dos crons distintos.
   */
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    configure(env);
    const now = new Date(event?.scheduledTime ?? Date.now());
    const runDaily = isLoyaltyDailyWindow(now);

    ctx.waitUntil(
      (async () => {
        const { db, close } = await createRequestDb(env.DATABASE_URL);
        try {
          // En CADA disparo: sesiones de mesa vencidas.
          await runWithDb(db, () => expireStale());

          // Una sola vez al día (madrugada de Lima): fidelización.
          if (runDaily) {
            logger.info("Worker cron: running daily loyalty jobs");
            await runWithDb(db, () => runLoyaltyJobs());
          }
        } finally {
          await close();
        }
      })(),
    );
  },
};
