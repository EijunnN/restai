import { redis, createSubscriber } from "../../lib/redis.js";
import { logger } from "../../lib/logger.js";
import type {
  RealtimeClientConfig,
  RealtimeProvider,
} from "../../core/ports/realtime.js";

export interface WsClient {
  ws: any;
  rooms: Set<string>;
  userId?: string;
  sessionId?: string;
  tokenExp?: number; // token expiry as unix timestamp (seconds)
}

/**
 * Adaptador realtime para el runtime de Bun (contenedor):
 * gestiona conexiones WebSocket en memoria y propaga eventos entre instancias
 * vía pub/sub de Redis. Implementa el puerto RealtimePublisher (método publish);
 * el resto de métodos los usa solo el entrypoint de Bun para manejar el socket.
 */
export class WebSocketManager implements RealtimeProvider {
  readonly name = "websocket";
  private clients = new Map<string, WsClient>();
  private rooms = new Map<string, Set<string>>();
  private subscriber;

  constructor() {
    this.subscriber = createSubscriber();
    this.setupSubscriber();
  }

  private setupSubscriber() {
    this.subscriber.on("message", (channel: string, message: string) => {
      this.broadcastToRoom(channel, message);
    });
  }

  getClient(id: string): WsClient | undefined {
    return this.clients.get(id);
  }

  addClient(id: string, ws: any, userId?: string, sessionId?: string, tokenExp?: number) {
    this.clients.set(id, { ws, rooms: new Set(), userId, sessionId, tokenExp });
  }

  removeClient(id: string) {
    const client = this.clients.get(id);
    if (client) {
      for (const room of client.rooms) {
        this.leaveRoom(id, room);
      }
      this.clients.delete(id);
    }
  }

  async joinRoom(clientId: string, room: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.rooms.add(room);

    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
      await this.subscriber.subscribe(room);
    }
    this.rooms.get(room)!.add(clientId);
  }

  async leaveRoom(clientId: string, room: string) {
    const client = this.clients.get(clientId);
    if (client) client.rooms.delete(room);

    const roomClients = this.rooms.get(room);
    if (roomClients) {
      roomClients.delete(clientId);
      if (roomClients.size === 0) {
        this.rooms.delete(room);
        await this.subscriber.unsubscribe(room);
      }
    }
  }

  private broadcastToRoom(room: string, message: string) {
    const roomClients = this.rooms.get(room);
    if (!roomClients) return;

    for (const clientId of roomClients) {
      const client = this.clients.get(clientId);
      if (client?.ws?.readyState === 1) {
        client.ws.send(message);
      }
    }
  }

  /**
   * Disconnects clients whose JWT token has expired.
   * Returns the number of disconnected clients.
   */
  evictExpired(): number {
    const now = Math.floor(Date.now() / 1000);
    let evicted = 0;

    for (const [id, client] of this.clients) {
      if (client.tokenExp && client.tokenExp < now) {
        try {
          client.ws.send(JSON.stringify({ type: "auth:expired", message: "Token expired", timestamp: Date.now() }));
          client.ws.close(4001, "Token expired");
        } catch {
          // Client may already be disconnected
        }
        this.removeClient(id);
        evicted++;
      }
    }

    return evicted;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  clientConfig(): RealtimeClientConfig {
    // El cliente se conecta a /ws?token=<jwt>; la autorización ocurre en el upgrade.
    return { provider: "websocket", path: "/ws", enabled: true };
  }

  async publish(room: string, data: object) {
    const payload = JSON.stringify(data);
    try {
      await redis.publish(room, payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown Redis publish error";
      logger.error("WebSocket publish failed, falling back to local broadcast", {
        room,
        error: message,
      });
      // Keep event delivery best-effort even when Redis is unavailable.
      this.broadcastToRoom(room, payload);
    }
  }
}
