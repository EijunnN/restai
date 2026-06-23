"use client";
import { useEffect, useRef } from "react";
import type { WsMessage } from "@restai/types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type Cleanup = () => void;

/** Config pública que devuelve `GET /api/realtime/config` (forma del puerto del backend). */
interface RealtimeClientConfig {
  provider: string;
  enabled?: boolean;
  authEndpoint?: string;
  [key: string]: unknown;
}

/**
 * Hook de mensajería en tiempo real, AGNÓSTICO al proveedor.
 *
 * Conserva la firma `useWebSocket(rooms, onMessage, token)` para no tocar los
 * componentes que lo usan. Internamente consulta `GET /api/realtime/config` y
 * conecta según el proveedor activo en el backend, sin asumir rutas ni claves:
 *   - `ably`      → SDK de Ably con token auth contra el `authEndpoint` del backend.
 *   - `websocket` → WebSocket nativo contra `/ws` (comportamiento original).
 *   - `noop`/otro → sin tiempo real.
 *
 * Toda la decisión vive en el backend; el cliente solo reacciona a la config.
 */
export function useWebSocket(
  rooms: string[],
  onMessage: (msg: WsMessage) => void,
  token?: string,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const roomsKey = rooms.join(",");

  useEffect(() => {
    if (!roomsKey || !token) return;

    let cancelled = false;
    let cleanup: Cleanup = () => {};

    (async () => {
      const config = await fetchConfig(token);
      if (cancelled) return;
      if (config.enabled === false) return;

      if (config.provider === "ably") {
        cleanup = await connectAbly(rooms, token, config, onMessageRef);
      } else if (config.provider === "websocket") {
        cleanup = connectWebSocket(rooms, token, onMessageRef);
      }
      // "noop" u otro proveedor desconocido → sin conexión.
      if (cancelled) cleanup();
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [roomsKey, token]);
}

/** Descubre la config realtime del backend. Si falla, cae al WebSocket nativo. */
async function fetchConfig(token: string): Promise<RealtimeClientConfig> {
  try {
    const res = await fetch(`${API}/api/realtime/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { provider: "websocket" };
    const json = await res.json();
    return (json?.data as RealtimeClientConfig) ?? { provider: "websocket" };
  } catch {
    return { provider: "websocket" };
  }
}

/** Une el `authEndpoint` del backend (relativo o absoluto) con la base de la API. */
function resolveUrl(endpoint: string | undefined, fallback: string): string {
  const path = endpoint ?? fallback;
  return /^https?:\/\//.test(path) ? path : `${API}${path}`;
}

/** Conexión vía Ably: token auth contra el endpoint del backend, una channel por sala. */
async function connectAbly(
  rooms: string[],
  token: string,
  config: RealtimeClientConfig,
  onMessageRef: React.MutableRefObject<(msg: WsMessage) => void>,
): Promise<Cleanup> {
  const Ably = (await import("ably")).default;
  const client = new Ably.Realtime({
    authUrl: resolveUrl(config.authEndpoint, "/api/realtime/auth"),
    authMethod: "POST",
    authHeaders: { Authorization: `Bearer ${token}` },
  });

  const channels = rooms.map((room) => {
    const channel = client.channels.get(room);
    channel.subscribe("message", (message) => {
      onMessageRef.current(message.data as WsMessage);
    });
    return channel;
  });

  return () => {
    for (const channel of channels) channel.unsubscribe();
    client.close();
  };
}

/** Conexión vía WebSocket nativo (proveedor "websocket"), con reconexión. */
function connectWebSocket(
  _rooms: string[],
  token: string,
  onMessageRef: React.MutableRefObject<(msg: WsMessage) => void>,
): Cleanup {
  let cancelled = false;
  let ws: WebSocket | null = null;

  function attemptConnect() {
    if (cancelled) return;
    const wsUrl = API.replace("http", "ws");
    ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);

    ws.onmessage = (event) => {
      try {
        onMessageRef.current(JSON.parse(event.data) as WsMessage);
      } catch {
        // mensaje inválido
      }
    };

    ws.onclose = () => {
      if (!cancelled) setTimeout(attemptConnect, 3000);
    };
  }

  attemptConnect();

  return () => {
    cancelled = true;
    ws?.close();
  };
}
