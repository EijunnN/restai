import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { verifyAccessToken } from "./lib/jwt.js";
import { WebSocketManager } from "./infrastructure/realtime/websocket.adapter.js";
import { createRealtimeProvider } from "./infrastructure/realtime/factory.js";
import { Argon2Hasher } from "./infrastructure/security/argon2.adapter.js";
import { useRealtime, useHasher } from "./infrastructure/container.js";
import { handleWsMessage } from "./ws/handlers.js";
import { whenDbReady } from "@restai/db";
import { expireStale } from "./services/session.service.js";
import { registerProcessErrorHandlers } from "./lib/process-handlers.js";
import {
  runLoyaltyJobs,
  SESSION_EXPIRY_INTERVAL_MS,
  WS_HEARTBEAT_INTERVAL_MS,
  LOYALTY_BOOT_DELAY_MS,
  LOYALTY_DAILY_INTERVAL_MS,
} from "./lib/jobs.js";

// ── Composition root del runtime Bun (contenedor) ─────────────────────
// Elige el proveedor realtime por entorno (REALTIME_PROVIDER) e inyecta argon2.
// El servidor WebSocket propio solo se activa si el proveedor es "websocket";
// con Pusher/Ably la entrega corre por el proveedor cloud y /ws queda deshabilitado.
const realtimeProvider = createRealtimeProvider();
useRealtime(realtimeProvider);
useHasher(new Argon2Hasher());

const wsManager =
  realtimeProvider instanceof WebSocketManager ? realtimeProvider : null;

// Espera la conexión de DB de módulo antes de servir (en contenedor/Bun la
// construcción es async; en Workers esto resuelve de inmediato).
await whenDbReady();

const port = parseInt(process.env.API_PORT || "3001");

const server = Bun.serve({
  port,
  maxRequestBodySize: 16 * 1024 * 1024, // 16MB
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (!wsManager) {
        return new Response(
          `WebSocket no habilitado (proveedor realtime: ${realtimeProvider.name}). Usa /api/realtime/config.`,
          { status: 501 },
        );
      }
      // Verify JWT on upgrade.
      //
      // TRADEOFF (documented decision): the token travels in the URL query
      // string rather than a header/subprotocol. Browsers' native WebSocket API
      // cannot set custom headers on the upgrade, so moving it would mean
      // reworking the realtime client/transport and risks breaking the feed. We
      // accept the query-string transport. Mitigation: reverse proxies (Traefik)
      // MUST strip/redact query strings from their access logs so tokens are not
      // persisted, and tokens are short-lived (evicted on expiry via heartbeat).
      const token = url.searchParams.get("token");
      if (!token) {
        return new Response("Token required", { status: 401 });
      }
      try {
        const payload: any = await verifyAccessToken(token);
        const upgraded = server.upgrade(req, {
          data: { id: crypto.randomUUID(), payload } as any,
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      } catch {
        return new Response("Invalid token", { status: 401 });
      }
    }
    return app.fetch(req, server);
  },
  websocket: {
    async open(ws) {
      if (!wsManager) return;
      const data = ws.data as any;
      // addClient + auto-join de salas + auth:success (lógica compartida con Node).
      // El scoping de salas de cliente (NO branch-wide para clientes, para no
      // filtrar la actividad de otras mesas) vive en WebSocketManager.register().
      await wsManager.register(data.id, ws, data.payload);
    },
    message(ws, message) {
      if (!wsManager) return;
      handleWsMessage(ws, String(message), wsManager);
    },
    close(ws) {
      if (!wsManager) return;
      wsManager.removeClient((ws.data as any).id);
    },
  },
});

logger.info("RestAI API running", { port, url: `http://localhost:${port}` });

// Session expiry cron. La cadencia y el cuerpo de los trabajos periódicos viven
// en lib/jobs.ts, compartidos con el entrypoint de Node y con el Worker.
const sessionExpiryInterval = setInterval(() => {
  expireStale().catch((err) => {
    logger.error("Session expiry cron failed", { error: err.message });
  });
}, SESSION_EXPIRY_INTERVAL_MS);

// WS heartbeat: evict clients with expired tokens.
// Solo aplica al servidor WebSocket propio (proveedor websocket).
const wsHeartbeatInterval = setInterval(() => {
  if (!wsManager) return;
  const evicted = wsManager.evictExpired();
  if (evicted > 0) {
    logger.info("WS heartbeat: evicted expired clients", { count: evicted });
  }
}, WS_HEARTBEAT_INTERVAL_MS);

// Trabajos diarios de fidelización: una pasada poco después del arranque
// (retardada para no bloquear el boot) y luego cada 24 h.
const loyaltyBootTimeout = setTimeout(() => void runLoyaltyJobs(), LOYALTY_BOOT_DELAY_MS);
const loyaltyDailyInterval = setInterval(
  () => void runLoyaltyJobs(),
  LOYALTY_DAILY_INTERVAL_MS,
);

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  clearInterval(sessionExpiryInterval);
  clearInterval(wsHeartbeatInterval);
  clearTimeout(loyaltyBootTimeout);
  clearInterval(loyaltyDailyInterval);
  server.stop();
  // Cierra el coordinador del WS (subscriber de Redis, si aplica).
  await wsManager?.close().catch(() => {});
  // Solo cierra Redis si llegó a conectarse (en modo local nunca conecta).
  if (redis.status === "ready" || redis.status === "connecting") {
    try {
      await redis.quit();
    } catch {
      // Redis may already be disconnected
    }
  }
  logger.info("Server stopped");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Errores no capturados (mismo comportamiento que el entrypoint de Node).
registerProcessErrorHandlers();
