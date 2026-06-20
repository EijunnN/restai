/**
 * Puertos de mensajería en tiempo real (salida).
 *
 * El dominio/HTTP solo conoce estas interfaces. La entrega concreta —WebSockets
 * de Bun + Redis, o un proveedor cloud como Pusher/Ably, o un no-op en serverless—
 * vive en los adaptadores de infraestructura y se elige en el composition root.
 */

/** Capacidad mínima que usa la app para emitir eventos a una "sala"/canal. */
export interface RealtimePublisher {
  publish(room: string, data: object): Promise<void> | void;
}

/** Configuración pública (sin secretos) que el cliente necesita para suscribirse. */
export interface RealtimeClientConfig {
  /** Identificador del proveedor: "websocket" | "pusher" | "ably" | "noop". */
  provider: string;
  [key: string]: unknown;
}

/** Petición de autorización de un canal privado (suscripción del cliente). */
export interface RealtimeAuthRequest {
  /** Id de socket (Pusher) que pide autorización. */
  socketId?: string;
  /** Canal/sala que se quiere suscribir. */
  channel?: string;
  /** Id de cliente (Ably). */
  clientId?: string;
  /** Salas a las que el usuario tiene acceso (scoping multi-tenant). */
  allowedRooms?: string[];
}

/**
 * Proveedor de realtime completo. Todo adaptador lo implementa.
 * - `publish` (de RealtimePublisher): emitir eventos.
 * - `name`: identificador del proveedor.
 * - `clientConfig`: datos públicos para que el cliente se conecte.
 * - `authorize` (opcional): firma la autorización de canales privados; solo lo
 *   implementan proveedores que lo requieren (Pusher, Ably).
 */
export interface RealtimeProvider extends RealtimePublisher {
  readonly name: string;
  clientConfig(): RealtimeClientConfig;
  authorize?(request: RealtimeAuthRequest): Promise<unknown>;
}
