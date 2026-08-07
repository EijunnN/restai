import { Hono } from "hono";
import { db } from "@restai/db";
import { sql } from "drizzle-orm";
import { getRealtimeProvider } from "../infrastructure/container.js";
import { getRedisStatus, redisSupported } from "../lib/redis.js";

const health = new Hono();

/**
 * Semáforo de salud del proceso.
 *
 * Comprueba la base de datos y —cuando de verdad hace falta— Redis. Redis solo
 * se sondea cuando el tiempo real corre sobre el WebSocket propio con
 * coordinador `redis`: ahí el pub/sub es lo único que hace que un pedido
 * publicado en la réplica A llegue a la pantalla de cocina conectada a la B, y
 * su caída no se nota por ninguna otra vía (el publish falla en un log y sigue).
 *
 * En el resto de despliegues (coordinador `local`, Ably/Pusher, o Workers, donde
 * no hay sockets TCP) Redis no se sondea siquiera: el único consumidor restante
 * es el rate limiter, que degrada solo a su cubo en memoria. Sondearlo ahí solo
 * serviría para ensuciar el diagnóstico por algo que no rompe nada —y, en local,
 * para despertar una conexión que nadie necesita.
 *
 * ── Por qué Redis NO puede tumbar el código HTTP ────────────────────────────
 * Este endpoint es el healthcheck del contenedor: docker-compose.yml lo sondea
 * con `wget -qO- http://localhost:3001/health`, que falla con cualquier código
 * >= 400. Detrás de Traefik/Coolify un contenedor "unhealthy" sale del balanceo.
 * Si un fallo de Redis devolviera 503, una caída de Redis dejaría al restaurante
 * ENTERO sin API —sin comandas, sin POS, sin cocina— para proteger algo que solo
 * degrada el fan-out del WebSocket entre réplicas. La cura sería mucho peor que
 * la enfermedad, y además afectaría al despliegue por defecto: docker-compose
 * define REDIS_URL y no fija REALTIME_WS_COORDINATOR, así que la factoría elige
 * el coordinador `redis` incluso con una sola instancia.
 *
 * Por eso la severidad va en el CUERPO y no en el código:
 *  - `status: "degraded"` + `checks.redis: "error"` para que la monitorización lo
 *    vea y alguien lo mire (que es lo que pedía el hallazgo);
 *  - 200 mientras el proceso pueda seguir sirviendo peticiones. Solo la base de
 *    datos, sin la cual no hay nada que servir, devuelve 503.
 */
health.get("/", async (c) => {
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  // El realtime se reporta por proveedor (sin acoplar Redis/ioredis aquí, para
  // que health corra también en runtimes serverless/edge).
  const provider = getRealtimeProvider();
  checks.realtime = provider.name;

  // Duck typing a propósito: importar WebSocketManager aquí arrastraría código
  // de Bun/Node a un módulo que también se sirve desde el runtime edge.
  const coordinator = (provider as { coordinatorName?: string }).coordinatorName;
  const redisRequired = redisSupported && coordinator === "redis";

  if (redisRequired) {
    checks.redis = await getRedisStatus();
  } else {
    checks.redis = "not_required";
  }

  // Puede servir peticiones: es lo único que decide el código HTTP.
  const canServe = checks.database === "ok";
  // Todo en orden, incluidas las dependencias que solo degradan.
  const allHealthy = canServe && (!redisRequired || checks.redis === "ok");

  return c.json(
    {
      status: allHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    canServe ? 200 : 503,
  );
});

export { health };
