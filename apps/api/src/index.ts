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
import { expirePoints, awardBirthdayBonuses } from "./services/loyalty.service.js";

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Loyalty points expiry job: expires earned points past their expires_at.
// Runs once shortly after boot, then every 24h. Non-blocking, set-based.
async function runExpirePoints() {
  try {
    const { expired } = await expirePoints();
    if (expired > 0) {
      logger.info("Loyalty points expiry job ran", { expired });
    }
  } catch (err) {
    logger.error("Loyalty points expiry job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Birthday bonus job: awards a birthday bonus to customers whose birthday is
// today (idempotent per customer per year). Runs once after boot, then every 24h.
async function runBirthdayBonuses() {
  try {
    const { awarded } = await awardBirthdayBonuses();
    if (awarded > 0) {
      logger.info("Birthday bonus job ran", { awarded });
    }
  } catch (err) {
    logger.error("Birthday bonus job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Run each once shortly after boot (delayed so startup isn't blocked).
const loyaltyBootTimeout = setTimeout(() => {
  void runExpirePoints();
  void runBirthdayBonuses();
}, 10_000);

// Daily loyalty jobs (~every 24h)
const pointsExpiryInterval = setInterval(() => {
  void runExpirePoints();
}, ONE_DAY_MS);

const birthdayBonusInterval = setInterval(() => {
  void runBirthdayBonuses();
}, ONE_DAY_MS);

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  clearInterval(sessionExpiryInterval);
  clearInterval(wsHeartbeatInterval);
  clearTimeout(loyaltyBootTimeout);
  clearInterval(pointsExpiryInterval);
  clearInterval(birthdayBonusInterval);
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
