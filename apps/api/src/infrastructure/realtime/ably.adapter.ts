import { createHmac, randomBytes } from "node:crypto";
import { logger } from "../../lib/logger.js";
import type {
  RealtimeAuthRequest,
  RealtimeClientConfig,
  RealtimeProvider,
} from "../../core/ports/realtime.js";

export interface AblyConfig {
  /** API key con formato `appId.keyId:keySecret`. */
  apiKey: string;
}

export function ablyConfigFromEnv(): AblyConfig | null {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey || !apiKey.includes(":")) return null;
  return { apiKey };
}

interface AblyTokenRequest {
  keyName: string;
  ttl: number;
  capability: string;
  clientId: string;
  timestamp: number;
  nonce: string;
  mac: string;
}

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Adaptador realtime con Ably (publica vía REST API).
 * Implementa RealtimeProvider: publish + clientConfig + authorize (TokenRequest
 * firmado para que el cliente se autentique con capacidades acotadas por tenant).
 */
export class AblyProvider implements RealtimeProvider {
  readonly name = "ably";
  private keyName: string;
  private keySecret: string;

  constructor(cfg: AblyConfig) {
    const [keyName, keySecret] = cfg.apiKey.split(":");
    this.keyName = keyName!;
    this.keySecret = keySecret!;
  }

  async publish(room: string, data: object): Promise<void> {
    // Ably admite `:` en los nombres de canal; se usa la sala tal cual.
    const url = `https://rest.ably.io/channels/${encodeURIComponent(room)}/messages`;
    const auth = Buffer.from(`${this.keyName}:${this.keySecret}`).toString(
      "base64",
    );
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({ name: "message", data }),
      });
      if (!res.ok) {
        logger.error("Ably publish failed", {
          room,
          status: res.status,
          body: await res.text().catch(() => ""),
        });
      }
    } catch (err) {
      logger.error("Ably publish error", {
        room,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  clientConfig(): RealtimeClientConfig {
    return {
      provider: "ably",
      enabled: true,
      authEndpoint: "/api/realtime/auth",
    };
  }

  /** Genera un TokenRequest firmado, con capacidades de solo-suscripción acotadas. */
  async authorize(req: RealtimeAuthRequest): Promise<AblyTokenRequest> {
    const rooms = req.allowedRooms ?? [];
    const caps = rooms.length
      ? Object.fromEntries(rooms.slice().sort().map((r) => [r, ["subscribe"]]))
      : { "*": ["subscribe"] };
    const capability = JSON.stringify(caps);

    const ttl = TOKEN_TTL_MS;
    const clientId = req.clientId ?? "";
    const timestamp = Date.now();
    const nonce = randomBytes(16).toString("hex");

    const signText = `${this.keyName}\n${ttl}\n${capability}\n${clientId}\n${timestamp}\n${nonce}\n`;
    const mac = createHmac("sha256", this.keySecret)
      .update(signText)
      .digest("base64");

    return { keyName: this.keyName, ttl, capability, clientId, timestamp, nonce, mac };
  }
}
