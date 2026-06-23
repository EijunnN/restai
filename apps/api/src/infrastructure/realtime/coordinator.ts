/**
 * Coordinador de fan-out para el servidor WebSocket nativo.
 *
 * El `WebSocketManager` mantiene las conexiones en memoria de UNA instancia. El
 * coordinador decide cómo se propaga un evento publicado a las demás instancias:
 *
 *  - `LocalCoordinator`: un solo proceso (VPS sencillo). El `publish` hace
 *    loopback en memoria; sin Redis ni dependencias externas.
 *  - `RedisCoordinator`: varias instancias (contenedor escalado, Vercel Fluid).
 *    Propaga vía Redis pub/sub para que un `publish` en la instancia A llegue a
 *    los clientes WebSocket conectados en la instancia B.
 *
 * Ambos exponen la misma interfaz, así que el manager es agnóstico al despliegue.
 */
export type CoordinatorMessageHandler = (room: string, payload: string) => void;

export interface RealtimeCoordinator {
  /** Identificador del coordinador ("local" | "redis"). */
  readonly name: string;
  /** Registra el handler que recibe los eventos a entregar a clientes locales. */
  onMessage(handler: CoordinatorMessageHandler): void;
  /** Empieza a recibir eventos de una sala (relevante solo en multi-instancia). */
  subscribe(room: string): void | Promise<void>;
  /** Deja de recibir eventos de una sala. */
  unsubscribe(room: string): void | Promise<void>;
  /** Publica un evento (string JSON ya serializado) a una sala. */
  publish(room: string, payload: string): void | Promise<void>;
  /** Libera recursos (conexiones) al apagar el proceso. */
  close(): void | Promise<void>;
}

/**
 * Coordinador in-process: el `publish` reentrega el evento al propio manager por
 * loopback. Apto para un despliegue de un solo proceso (VPS) sin Redis.
 */
export class LocalCoordinator implements RealtimeCoordinator {
  readonly name = "local";
  private handler: CoordinatorMessageHandler = () => {};

  onMessage(handler: CoordinatorMessageHandler): void {
    this.handler = handler;
  }

  // En un solo proceso no hay nada que (des)suscribir: el manager ya conoce
  // qué clientes locales pertenecen a cada sala.
  subscribe(): void {}
  unsubscribe(): void {}

  publish(room: string, payload: string): void {
    this.handler(room, payload);
  }

  close(): void {}
}
