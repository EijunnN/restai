import { redis, createSubscriber } from "../lib/redis.js";

export interface WsClient {
  ws: any;
  rooms: Set<string>;
  userId?: string;
  sessionId?: string;
}

export class WebSocketManager {
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

  addClient(id: string, ws: any, userId?: string, sessionId?: string) {
    this.clients.set(id, { ws, rooms: new Set(), userId, sessionId });
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

  async publish(room: string, data: object) {
    await redis.publish(room, JSON.stringify(data));
  }
}

export const wsManager = new WebSocketManager();
