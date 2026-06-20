import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { verifyAccessToken } from "./lib/jwt.js";
import { wsManager } from "./ws/manager.js";
import { handleWsMessage } from "./ws/handlers.js";
import { expireStale } from "./services/session.service.js";

const port = parseInt(process.env.API_PORT || "3001");

const server = Bun.serve({
  port,
  maxRequestBodySize: 16 * 1024 * 1024, // 16MB
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
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
      const data = ws.data as any;
      wsManager.addClient(data.id, ws, data.payload.sub, undefined, data.payload.exp);

      // Auto-join rooms based on pre-verified token payload.
      if (data.payload.role === "customer") {
        // Customers must NOT join the branch-wide room: it carries every table's
        // order events and would leak other diners' activity. They only receive
        // their own session room (customer-relevant events are published to
        // session:{table_session_id}) plus their own table room.
        await wsManager.joinRoom(data.id, `session:${data.payload.sub}`);
        if (data.payload.table) await wsManager.joinRoom(data.id, `table:${data.payload.table}`);
      } else if (data.payload.branches) {
        for (const branchId of data.payload.branches) {
          await wsManager.joinRoom(data.id, `branch:${branchId}`);
        }
      }

      ws.send(JSON.stringify({ type: "auth:success", userId: data.payload.sub, timestamp: Date.now() }));
    },
    message(ws, message) {
      handleWsMessage(ws, String(message), wsManager);
    },
    close(ws) {
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

// WS heartbeat: evict clients with expired tokens (every 30 seconds)
const wsHeartbeatInterval = setInterval(() => {
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
  try {
    await redis.quit();
  } catch {
    // Redis may already be disconnected
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
