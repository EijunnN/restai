import type { RealtimePublisher } from "../../core/ports/realtime.js";

/**
 * Adaptador realtime nulo: no entrega eventos en vivo.
 *
 * Es el default seguro para runtimes serverless/edge (sin WebSockets persistentes),
 * donde el tiempo real se resolvería con polling/SSE o Durable Objects. Mantiene la
 * app 100% funcional (REST + SUNAT) sin acoplar Redis ni sockets.
 */
export class NoopRealtime implements RealtimePublisher {
  publish(_room: string, _data: object): void {
    // Intencionalmente vacío.
  }
}
