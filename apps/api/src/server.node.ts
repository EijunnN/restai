import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";
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

// ── Composition root del runtime Node ─────────────────────────────────
// Entrypoint alternativo al de Bun (index.ts) para correr en Node: un VPS con
// Node, o Vercel Functions (que ahora sirven WebSockets nativos con Fluid
// compute). Reutiliza EXACTAMENTE el mismo WebSocketManager: el servidor WS vive
// en el MISMO proceso que el HTTP de Hono, con `ws` para el upgrade.
//
// Realtime por entorno (REALTIME_PROVIDER):
//   - websocket → WS nativo in-process. Coordinador `local` (un proceso) o
//     `redis` (multi-instancia: VPS escalado o Vercel, donde cada conexión queda
//     fijada a una instancia distinta y hace falta Redis pub/sub).
//   - ably/pusher/noop → igual que en el resto de runtimes.
// Hashing con argon2 (Node soporta el binario nativo): verifica los hashes
// argon2 existentes Y los pbkdf2 creados en runtimes edge (verify dual-formato),
// evitando dejar fuera a los usuarios actuales en el entrypoint Node.
const realtimeProvider = createRealtimeProvider();
useRealtime(realtimeProvider);
useHasher(new Argon2Hasher());

const wsManager =
  realtimeProvider instanceof WebSocketManager ? realtimeProvider : null;

// Espera la conexión de DB de módulo antes de servir (proceso persistente).
await whenDbReady();

const port = parseInt(process.env.API_PORT || process.env.PORT || "3001");

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info("RestAI API (Node) running", {
    port: info.port,
    realtime: realtimeProvider.name,
    coordinator: wsManager?.coordinatorName,
  });
});

// Servidor WebSocket nativo en el mismo proceso (solo si el proveedor es "websocket").
if (wsManager) {
  const wss = new WebSocketServer({ noServer: true });

  // `serve()` devuelve el http.Server de Node; interceptamos el upgrade de /ws.
  (server as unknown as import("node:http").Server).on(
    "upgrade",
    async (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      const token = url.searchParams.get("token");
      if (!token) {
        socket.destroy();
        return;
      }
      let payload: any;
      try {
        payload = await verifyAccessToken(token);
      } catch {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const id = randomUUID();
        // addClient + auto-join de salas + auth:success (lógica compartida con Bun).
        void wsManager.register(id, ws, payload);
        ws.on("message", (raw) =>
          handleWsMessage(ws, raw.toString(), wsManager),
        );
        ws.on("close", () => wsManager.removeClient(id));
      });
    },
  );
}

// Tareas periódicas. La cadencia y el cuerpo viven en lib/jobs.ts, compartidos
// con el entrypoint de Bun y con el Worker, para que los tres runtimes hagan
// exactamente lo mismo y con la misma frecuencia.
const sessionExpiryInterval = setInterval(() => {
  expireStale().catch((err) => {
    logger.error("Session expiry cron failed", { error: err.message });
  });
}, SESSION_EXPIRY_INTERVAL_MS);

// WS heartbeat: cierra clientes con JWT expirado.
const wsHeartbeatInterval = setInterval(() => {
  if (!wsManager) return;
  const evicted = wsManager.evictExpired();
  if (evicted > 0) {
    logger.info("WS heartbeat: evicted expired clients", { count: evicted });
  }
}, WS_HEARTBEAT_INTERVAL_MS);

const loyaltyBootTimeout = setTimeout(() => void runLoyaltyJobs(), LOYALTY_BOOT_DELAY_MS);
const loyaltyDailyInterval = setInterval(
  () => void runLoyaltyJobs(),
  LOYALTY_DAILY_INTERVAL_MS,
);

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  clearTimeout(loyaltyBootTimeout);
  clearInterval(loyaltyDailyInterval);
  clearInterval(sessionExpiryInterval);
  clearInterval(wsHeartbeatInterval);
  await wsManager?.close().catch(() => {});
  (server as unknown as import("node:http").Server).close();
  logger.info("Server stopped");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Errores no capturados. Sin esto, en Node ≥15 una promesa rechazada sin
// manejar (un correo fire-and-forget, un publish realtime) tumbaba el proceso
// entero de la API, mientras el mismo código en Bun solo dejaba un log.
registerProcessErrorHandlers();

// Export por defecto para hosts que lo esperan (p. ej. Vercel Functions).
export default server;
