import type { RealtimeProvider } from "../../core/ports/realtime.js";
import { logger } from "../../lib/logger.js";
import { NoopRealtime } from "./noop.adapter.js";
import { WebSocketManager } from "./bun-redis.adapter.js";
import { PusherProvider, pusherConfigFromEnv } from "./pusher.adapter.js";
import { AblyProvider, ablyConfigFromEnv } from "./ably.adapter.js";

/**
 * Crea el proveedor realtime según `REALTIME_PROVIDER`
 * (`websocket` por defecto | `pusher` | `ably` | `noop`).
 *
 * Si se pide un proveedor cloud sin su configuración, cae a `noop` (la app sigue
 * operativa, solo sin tiempo real). Añadir un proveedor nuevo = un `case` aquí.
 */
export function createRealtimeProvider(): RealtimeProvider {
  const choice = (process.env.REALTIME_PROVIDER ?? "websocket").toLowerCase();

  switch (choice) {
    case "pusher": {
      const cfg = pusherConfigFromEnv();
      if (!cfg) {
        logger.error("REALTIME_PROVIDER=pusher pero falta config PUSHER_*; usando noop");
        return new NoopRealtime();
      }
      logger.info("Realtime provider: pusher");
      return new PusherProvider(cfg);
    }
    case "ably": {
      const cfg = ablyConfigFromEnv();
      if (!cfg) {
        logger.error("REALTIME_PROVIDER=ably pero falta ABLY_API_KEY; usando noop");
        return new NoopRealtime();
      }
      logger.info("Realtime provider: ably");
      return new AblyProvider(cfg);
    }
    case "noop":
      logger.info("Realtime provider: noop");
      return new NoopRealtime();
    case "websocket":
    default:
      logger.info("Realtime provider: websocket");
      return new WebSocketManager();
  }
}
