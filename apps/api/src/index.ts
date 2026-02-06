import { app } from "./app.js";
import { wsManager } from "./ws/manager.js";
import { handleWsMessage } from "./ws/handlers.js";

const port = parseInt(process.env.API_PORT || "3001");

const server = Bun.serve({
  port,
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

console.log(`RestAI API running on http://localhost:${port}`);
