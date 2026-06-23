import type {
  RealtimeClientConfig,
  RealtimeProvider,
} from "../../core/ports/realtime.js";
import type { RealtimeCoordinator } from "./coordinator.js";

export interface WsClient {
  ws: any;
  rooms: Set<string>;
  userId?: string;
  sessionId?: string;
  tokenExp?: number; // token expiry as unix timestamp (seconds)
}

/** Payload del JWT ya verificado que el entrypoint pasa al registrar la conexión. */
export interface WsAuthPayload {
  sub: string;
  exp?: number;
  role?: string;
  branch?: string;
  table?: string;
  branches?: string[];
}

/**
 * Servidor WebSocket nativo, in-process: gestiona las conexiones en memoria de
 * una instancia y propaga eventos entre instancias mediante un
 * {@link RealtimeCoordinator} (local en un solo proceso, o Redis pub/sub en
 * varios). Implementa el puerto RealtimeProvider (publish + clientConfig); el
 * resto de métodos los usa el entrypoint (Bun o Node) para manejar el socket.
 *
 * Es agnóstico al transporte: solo asume que cada socket expone `send`, `close`
 * y `readyState` (lo cumplen tanto el `ServerWebSocket` de Bun como el
 * `WebSocket` de la librería `ws` en Node/Vercel).
 */
export class WebSocketManager implements RealtimeProvider {
  readonly name = "websocket";
  private clients = new Map<string, WsClient>();
  private rooms = new Map<string, Set<string>>();

  constructor(private readonly coordinator: RealtimeCoordinator) {
    // Lo que llega del coordinador (loopback local o pub/sub Redis) se entrega a
    // los clientes conectados a ESTA instancia.
    this.coordinator.onMessage((room, message) =>
      this.broadcastToRoom(room, message),
    );
  }

  /** Nombre del coordinador activo ("local" | "redis"), para diagnóstico. */
  get coordinatorName(): string {
    return this.coordinator.name;
  }

  getClient(id: string): WsClient | undefined {
    return this.clients.get(id);
  }

  addClient(
    id: string,
    ws: any,
    userId?: string,
    sessionId?: string,
    tokenExp?: number,
  ) {
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

  /**
   * Registra una conexión recién autenticada y la auto-suscribe a sus salas
   * según el JWT. Reutilizado por los entrypoints de Bun y de Node, así la
   * lógica de salas vive en un solo sitio.
   */
  async register(id: string, ws: any, payload: WsAuthPayload) {
    this.addClient(id, ws, payload.sub, undefined, payload.exp);

    if (payload.role === "customer") {
      if (payload.branch) await this.joinRoom(id, `branch:${payload.branch}`);
      if (payload.table) await this.joinRoom(id, `table:${payload.table}`);
      await this.joinRoom(id, `session:${payload.sub}`);
    } else if (payload.branches) {
      for (const branchId of payload.branches) {
        await this.joinRoom(id, `branch:${branchId}`);
      }
    }

    this.safeSend(
      ws,
      JSON.stringify({ type: "auth:success", userId: payload.sub, timestamp: Date.now() }),
    );
  }

  async joinRoom(clientId: string, room: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.rooms.add(room);

    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
      await this.coordinator.subscribe(room);
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
        await this.coordinator.unsubscribe(room);
      }
    }
  }

  private safeSend(ws: any, message: string) {
    if (ws?.readyState === 1) {
      try {
        ws.send(message);
      } catch {
        // socket cerrándose
      }
    }
  }

  private broadcastToRoom(room: string, message: string) {
    const roomClients = this.rooms.get(room);
    if (!roomClients) return;

    for (const clientId of roomClients) {
      const client = this.clients.get(clientId);
      if (client) this.safeSend(client.ws, message);
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
          client.ws.send(
            JSON.stringify({ type: "auth:expired", message: "Token expired", timestamp: Date.now() }),
          );
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
    await this.coordinator.publish(room, JSON.stringify(data));
  }

  /** Libera el coordinador (subscriber de Redis) al apagar el proceso. */
  async close() {
    await this.coordinator.close();
  }
}
