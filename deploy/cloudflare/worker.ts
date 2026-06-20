/**
 * Worker "shim" para desplegar la API de RestAI en Cloudflare Containers.
 *
 * NO modifica la API: el contenedor corre la MISMA imagen `Dockerfile.api`
 * (Bun + Hono + WebSockets + argon2 + ioredis). Este Worker solo enruta las
 * peticiones entrantes hacia la instancia del contenedor a través de un
 * Durable Object, y le pasa las variables de entorno/secretos.
 *
 * Requiere la dependencia `@cloudflare/containers` (ver package.json de esta carpeta).
 */
import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  REST_API: DurableObjectNamespace;
  DATABASE_URL: string;
  DATABASE_DRIVER?: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  SUNAT_ENCRYPTION_KEY: string;
  REDIS_URL: string;
  CORS_ORIGINS?: string;
  LOG_LEVEL?: string;
  REALTIME_PROVIDER?: string;
  PUSHER_APP_ID?: string;
  PUSHER_KEY?: string;
  PUSHER_SECRET?: string;
  PUSHER_CLUSTER?: string;
  ABLY_API_KEY?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_URL?: string;
}

export class RestaiApiContainer extends Container<Env> {
  /** Puerto en el que escucha la API dentro del contenedor (API_PORT). */
  defaultPort = 3001;
  /** Suspender el contenedor tras 15 min de inactividad para ahorrar. */
  sleepAfter = "15m";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Los secretos del Worker (wrangler secret) se pasan al contenedor como env vars.
    this.envVars = {
      API_PORT: "3001",
      DATABASE_URL: env.DATABASE_URL,
      DATABASE_DRIVER: env.DATABASE_DRIVER ?? "postgres-js",
      JWT_SECRET: env.JWT_SECRET,
      JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
      SUNAT_ENCRYPTION_KEY: env.SUNAT_ENCRYPTION_KEY,
      REDIS_URL: env.REDIS_URL,
      CORS_ORIGINS: env.CORS_ORIGINS ?? "",
      LOG_LEVEL: env.LOG_LEVEL ?? "info",
      REALTIME_PROVIDER: env.REALTIME_PROVIDER ?? "websocket",
      PUSHER_APP_ID: env.PUSHER_APP_ID ?? "",
      PUSHER_KEY: env.PUSHER_KEY ?? "",
      PUSHER_SECRET: env.PUSHER_SECRET ?? "",
      PUSHER_CLUSTER: env.PUSHER_CLUSTER ?? "",
      ABLY_API_KEY: env.ABLY_API_KEY ?? "",
      R2_ACCOUNT_ID: env.R2_ACCOUNT_ID ?? "",
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID ?? "",
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? "",
      R2_BUCKET_NAME: env.R2_BUCKET_NAME ?? "restai",
      R2_PUBLIC_URL: env.R2_PUBLIC_URL ?? "",
    };
  }
}

export default {
  async fetch(request: Request, env: Env) {
    // Una sola instancia lógica del contenedor (escalable con max_instances).
    return getContainer(env.REST_API).fetch(request);
  },
};
