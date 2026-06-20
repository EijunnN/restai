import type { RealtimeProvider } from "../../core/ports/realtime.js";
import { logger } from "../../lib/logger.js";
import { NoopRealtime } from "./noop.adapter.js";
import { PusherProvider, pusherConfigFromEnv } from "./pusher.adapter.js";
import { AblyProvider, ablyConfigFromEnv } from "./ably.adapter.js";

/**
 * Factory de realtime para runtimes serverless/edge (Cloudflare Workers).
 *
 * A diferencia de `factory.ts`, NO importa el adaptador WebSocket+Redis (que
 * arrastra ioredis y no corre en Workers). Solo proveedores cloud o no-op.
 */
export function createServerlessRealtimeProvider(): RealtimeProvider {
  const choice = (process.env.REALTIME_PROVIDER ?? "noop").toLowerCase();

  switch (choice) {
    case "pusher": {
      const cfg = pusherConfigFromEnv();
      if (!cfg) {
        logger.error("REALTIME_PROVIDER=pusher pero falta config PUSHER_*; usando noop");
        return new NoopRealtime();
      }
      return new PusherProvider(cfg);
    }
    case "ably": {
      const cfg = ablyConfigFromEnv();
      if (!cfg) {
        logger.error("REALTIME_PROVIDER=ably pero falta ABLY_API_KEY; usando noop");
        return new NoopRealtime();
      }
      return new AblyProvider(cfg);
    }
    case "websocket":
      logger.error(
        "REALTIME_PROVIDER=websocket no aplica en serverless (sin sockets persistentes); usa pusher/ably. Usando noop.",
      );
      return new NoopRealtime();
    default:
      return new NoopRealtime();
  }
}
