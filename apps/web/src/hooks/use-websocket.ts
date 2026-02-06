"use client";

import { useEffect, useRef, useCallback } from "react";
import type { WsMessage } from "@restai/types";

export function useWebSocket(
  rooms: string[],
  onMessage: (msg: WsMessage) => void,
  token?: string
) {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
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
        onMessage(msg);
      } catch {
        // Invalid message
      }
    };

    ws.onclose = () => {
      setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, [rooms, onMessage, token]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef;
}
