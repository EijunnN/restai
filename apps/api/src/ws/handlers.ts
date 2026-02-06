import { verifyAccessToken } from "../lib/jwt.js";
import type { WebSocketManager } from "./manager.js";

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

  const clientId = (ws.data as any)?.id;

  switch (data.type) {
    case "auth": {
      if (!data.token) {
        ws.send(JSON.stringify({ type: "error", message: "Token required" }));
        return;
      }

      try {
        const payload: any = await verifyAccessToken(data.token);
        // Associate user with client
        const client = manager.getClient(clientId);
        if (client) {
          client.userId = payload.sub;
          client.sessionId = payload.sub;
        }

        // Auto-join relevant rooms based on role
        if (payload.role === "customer") {
          await manager.joinRoom(clientId, `branch:${payload.branch}`);
          await manager.joinRoom(clientId, `table:${payload.table}`);
        } else if (payload.branches) {
          for (const branchId of payload.branches) {
            await manager.joinRoom(clientId, `branch:${branchId}`);
          }
        }

        ws.send(JSON.stringify({ type: "auth:success", userId: payload.sub, timestamp: Date.now() }));
      } catch {
        ws.send(JSON.stringify({ type: "auth:error", message: "Invalid token", timestamp: Date.now() }));
      }
      break;
    }

    case "join": {
      if (data.room) {
        await manager.joinRoom(clientId, data.room);
        ws.send(JSON.stringify({ type: "joined", room: data.room, timestamp: Date.now() }));
      }
      break;
    }

    case "leave": {
      if (data.room) {
        await manager.leaveRoom(clientId, data.room);
        ws.send(JSON.stringify({ type: "left", room: data.room, timestamp: Date.now() }));
      }
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
