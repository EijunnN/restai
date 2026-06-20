import type {
  RealtimeClientConfig,
  RealtimeProvider,
} from "../../core/ports/realtime.js";

/**
 * Adaptador realtime nulo: no entrega eventos en vivo.
 *
 * Default seguro para runtimes serverless/edge sin transporte realtime configurado.
 * Mantiene la app 100% funcional (REST + SUNAT) sin acoplar Redis ni sockets.
 */
export class NoopRealtime implements RealtimeProvider {
  readonly name = "noop";

  publish(_room: string, _data: object): void {
    // Intencionalmente vacío.
  }

  clientConfig(): RealtimeClientConfig {
    return { provider: "noop", enabled: false };
  }
}
