"use client";
import { useEffect, useRef } from "react";
import type { WsMessage } from "@restai/types";
import { useAuthStore } from "@/stores/auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Reconnect backoff tuning.
const BASE_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30000; // cap at 30s
const PING_INTERVAL = 25000; // 25s — matches the server's ping/pong handler

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Refresh the dashboard access token via the auth store's refresh token.
 * Deduplicates concurrent refreshes. Only relevant for dashboard tokens
 * (customer tokens are not stored in the auth store).
 */
async function refreshDashboardToken(): Promise<string | null> {
  const { refreshToken, setAccessToken, logout } = useAuthStore.getState();
  if (!refreshToken) return null;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        const json = await res.json();
        if (json.success && json.data?.accessToken) {
          setAccessToken(json.data.accessToken);
          return json.data.accessToken as string;
        }
        logout();
        return null;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export function useWebSocket(
  rooms: string[],
  onMessage: (msg: WsMessage) => void,
  token?: string
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Keep the latest token in a ref so reconnect attempts always read a fresh
  // (possibly refreshed) token rather than a value captured at effect setup.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const roomsKey = rooms.join(",");

  useEffect(() => {
    if (!roomsKey) return;

    let cancelled = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const clearTimers = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      // Exponential backoff with full jitter, capped at MAX_RECONNECT_DELAY.
      const expDelay = Math.min(
        MAX_RECONNECT_DELAY,
        BASE_RECONNECT_DELAY * 2 ** attempts
      );
      const delay = Math.round(Math.random() * expDelay);
      attempts += 1;
      reconnectTimer = setTimeout(attemptConnect, delay);
    };

    function attemptConnect() {
      if (cancelled) return;

      // Read the freshest token at connect time (ref, not the captured arg).
      const currentToken = tokenRef.current;
      if (!currentToken) {
        // No token yet; back off and retry — a refresh elsewhere may set one.
        scheduleReconnect();
        return;
      }

      const wsUrl = API_URL.replace("http", "ws");
      const ws = new WebSocket(
        `${wsUrl}/ws?token=${encodeURIComponent(currentToken)}`
      );

      ws.onopen = () => {
        // Auth happens on upgrade via query param; connection is live.
        attempts = 0; // reset backoff after a successful connection
        // Client ping keeps the connection warm and matches the server pong.
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          onMessageRef.current(msg);
        } catch {
          // Invalid message
        }
      };

      ws.onclose = (event) => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (cancelled) return;

        // 4001 = server rejected/expired the token. If it matches the current
        // dashboard token, try refreshing before reconnecting so we don't
        // hammer the server with a stale token.
        if (
          event.code === 4001 &&
          tokenRef.current === useAuthStore.getState().accessToken
        ) {
          void refreshDashboardToken().then((newToken) => {
            if (cancelled) return;
            if (newToken) tokenRef.current = newToken;
            scheduleReconnect();
          });
          return;
        }

        scheduleReconnect();
      };

      wsRef.current = ws;
    }

    attemptConnect();

    return () => {
      cancelled = true;
      clearTimers();
      wsRef.current?.close();
    };
  }, [roomsKey, token]);

  return wsRef;
}
