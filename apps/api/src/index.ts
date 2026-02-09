import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { wsManager } from "./ws/manager.js";
import { handleWsMessage } from "./ws/handlers.js";

const port = parseInt(process.env.API_PORT || "3001");

const server = Bun.serve({
  port,
  maxRequestBodySize: 16 * 1024 * 1024, // 16MB
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: { id: crypto.randomUUID() } as any,
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req, server);
  },
  websocket: {
    open(ws) {
      wsManager.addClient((ws.data as any).id, ws);
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

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
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
