/**
 * Puerto de mensajería en tiempo real (salida).
 *
 * El dominio/HTTP solo conoce esta interfaz para emitir eventos a una "sala"
 * (branch, sesión, cocina…). La forma concreta de entregarlos —WebSockets de Bun
 * + Redis en contenedor, o un no-op / SSE / Durable Objects en serverless— vive en
 * los adaptadores de infraestructura y se decide en el composition root.
 */
export interface RealtimePublisher {
  /** Publica un evento a todos los suscriptores de una sala. */
  publish(room: string, data: object): Promise<void> | void;
}
