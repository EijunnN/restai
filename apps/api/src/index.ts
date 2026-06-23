import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { verifyAccessToken } from "./lib/jwt.js";
import { WebSocketManager } from "./infrastructure/realtime/websocket.adapter.js";
import { createRealtimeProvider } from "./infrastructure/realtime/factory.js";
import { Argon2Hasher } from "./infrastructure/security/argon2.adapter.js";
import { useRealtime, useHasher } from "./infrastructure/container.js";
import { handleWsMessage } from "./ws/handlers.js";
import { expireStale } from "./services/session.service.js";

// ── Composition root del runtime Bun (contenedor) ─────────────────────
// Elige el proveedor realtime por entorno (REALTIME_PROVIDER) e inyecta argon2.
// El servidor WebSocket propio solo se activa si el proveedor es "websocket";
// con Pusher/Ably la entrega corre por el proveedor cloud y /ws queda deshabilitado.
const realtimeProvider = createRealtimeProvider();
useRealtime(realtimeProvider);
useHasher(new Argon2Hasher());

const wsManager =
  realtimeProvider instanceof WebSocketManager ? realtimeProvider : null;

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
      // Verify JWT on upgrade
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

// Session expiry cron (every 60 seconds)
const sessionExpiryInterval = setInterval(() => {
  expireStale().catch((err) => {
    logger.error("Session expiry cron failed", { error: err.message });
  });
}, 60_000);

// WS heartbeat: evict clients with expired tokens (every 30 seconds).
// Solo aplica al servidor WebSocket propio (proveedor websocket).
const wsHeartbeatInterval = setInterval(() => {
  if (!wsManager) return;
  const evicted = wsManager.evictExpired();
  if (evicted > 0) {
    logger.info("WS heartbeat: evicted expired clients", { count: evicted });
  }
}, 30_000);

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  clearInterval(sessionExpiryInterval);
  clearInterval(wsHeartbeatInterval);
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

// Unhandled error handlers
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { error: reason instanceof Error ? reason.message : String(reason) });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack });
  process.exit(1);
});
