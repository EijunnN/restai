"use client";
import { useEffect, useRef } from "react";
import type { WsMessage } from "@restai/types";

export function useWebSocket(
  rooms: string[],
  onMessage: (msg: WsMessage) => void,
  token?: string
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const roomsKey = rooms.join(",");

  useEffect(() => {
    if (!roomsKey) return;

    let cancelled = false;

    function attemptConnect() {
      if (cancelled) return;

      const wsUrl = (
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
      ).replace("http", "ws");
      const ws = new WebSocket(`${wsUrl}/ws`);

      ws.onopen = () => {
        if (token) {
          ws.send(JSON.stringify({ type: "auth", token }));
        }
        rooms.forEach((room) => {
          ws.send(JSON.stringify({ type: "join", room }));
        });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          onMessageRef.current(msg);
        } catch {
          // Invalid message
        }
      };

      ws.onclose = () => {
        if (!cancelled) {
          setTimeout(attemptConnect, 3000);
        }
      };

      wsRef.current = ws;
    }

    attemptConnect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [roomsKey, token]);

  return wsRef;
}
