import { createHash, createHmac } from "node:crypto";
import { logger } from "../../lib/logger.js";
import type {
  RealtimeAuthRequest,
  RealtimeClientConfig,
  RealtimeProvider,
} from "../../core/ports/realtime.js";

export interface PusherConfig {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

/** Lee la config de Pusher de variables de entorno. Devuelve null si falta algo. */
export function pusherConfigFromEnv(): PusherConfig | null {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;
  if (!appId || !key || !secret || !cluster) return null;
  return { appId, key, secret, cluster };
}

/**
 * Convierte una sala interna (`branch:uuid`) en un nombre de canal privado de
 * Pusher. Pusher no admite `:` en los nombres de canal, así que se reemplaza por `-`.
 */
export function roomToChannel(room: string): string {
  return `private-${room.replace(/:/g, "-")}`;
}

/**
 * Adaptador realtime con Pusher Channels (publica vía REST API firmada).
 * Implementa RealtimeProvider: publish + clientConfig + authorize (canal privado).
 */
export class PusherProvider implements RealtimeProvider {
  readonly name = "pusher";
  private cfg: PusherConfig;
  private host: string;

  constructor(cfg: PusherConfig) {
    this.cfg = cfg;
    this.host = `api-${cfg.cluster}.pusher.com`;
  }

  async publish(room: string, data: object): Promise<void> {
    const channel = roomToChannel(room);
    const body = JSON.stringify({
      name: "message",
      channel,
      data: JSON.stringify(data),
    });

    const bodyMd5 = createHash("md5").update(body).digest("hex");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = `/apps/${this.cfg.appId}/events`;
    const params: Record<string, string> = {
      auth_key: this.cfg.key,
      auth_timestamp: timestamp,
      auth_version: "1.0",
      body_md5: bodyMd5,
    };
    const sortedQuery = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    const toSign = ["POST", path, sortedQuery].join("\n");
    const signature = createHmac("sha256", this.cfg.secret)
      .update(toSign)
      .digest("hex");

    const url = `https://${this.host}${path}?${sortedQuery}&auth_signature=${signature}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        logger.error("Pusher publish failed", {
          room,
          status: res.status,
          body: await res.text().catch(() => ""),
        });
      }
    } catch (err) {
      logger.error("Pusher publish error", {
        room,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  clientConfig(): RealtimeClientConfig {
    return {
      provider: "pusher",
      enabled: true,
      key: this.cfg.key,
      cluster: this.cfg.cluster,
      authEndpoint: "/api/realtime/auth",
    };
  }

  /**
   * Autoriza la suscripción a un canal privado: devuelve `{ auth: "key:hmac" }`.
   * El canal debe corresponder a una sala permitida del usuario (multi-tenant).
   */
  async authorize(req: RealtimeAuthRequest): Promise<{ auth: string }> {
    if (!req.socketId || !req.channel) {
      throw new Error("Faltan socket_id o channel para autorizar");
    }
    const allowed = (req.allowedRooms ?? []).map(roomToChannel);
    if (!allowed.includes(req.channel)) {
      throw new Error("Canal no permitido para este usuario");
    }
    const stringToSign = `${req.socketId}:${req.channel}`;
    const signature = createHmac("sha256", this.cfg.secret)
      .update(stringToSign)
      .digest("hex");
    return { auth: `${this.cfg.key}:${signature}` };
  }
}
