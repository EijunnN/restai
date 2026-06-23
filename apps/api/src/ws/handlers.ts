import type { WebSocketManager } from "../infrastructure/realtime/websocket.adapter.js";

export async function handleWsMessage(
  ws: any,
  rawMessage: string,
  manager: WebSocketManager,
) {
  let data: any;
  try {
    data = JSON.parse(rawMessage);
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    return;
  }

  switch (data.type) {
    case "auth": {
      // Auth now happens on WS upgrade. This is kept for backward compatibility.
      const clientId = (ws.data as any)?.id;
      const client = manager.getClient(clientId);
      if (client?.userId) {
        ws.send(JSON.stringify({ type: "auth:success", userId: client.userId, timestamp: Date.now() }));
      } else {
        ws.send(JSON.stringify({ type: "auth:error", message: "Not authenticated. Pass token as query param on connect.", timestamp: Date.now() }));
      }
      break;
    }

    case "join": {
      ws.send(JSON.stringify({ type: "error", message: "Rooms are assigned automatically on auth" }));
      break;
    }

    case "leave": {
      ws.send(JSON.stringify({ type: "error", message: "Room management is automatic" }));
      break;
    }

    case "ping": {
      ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      break;
    }

    default:
      ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${data.type}` }));
  }
}
