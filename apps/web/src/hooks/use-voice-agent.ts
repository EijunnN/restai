"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectOpenAI } from "@/lib/voice-transport/openai-webrtc";
import { connectGemini } from "@/lib/voice-transport/gemini-live";
import type {
  VoiceGrant,
  VoiceState,
  VoiceTransportHandle,
} from "@/lib/voice-transport/types";

export type { VoiceState } from "@/lib/voice-transport/types";

/**
 * Mesero por voz: orquestación.
 *
 * Este hook no sabe hablar con ningún proveedor. Pide la credencial a NUESTRA
 * API, mira qué transporte le toca y delega. Toda la diferencia entre OpenAI
 * (WebRTC) y Gemini (WebSocket con PCM) vive en `lib/voice-transport/`, y por
 * encima de esta línea nada la nota.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface VoiceCatalogEntry {
  ref: string;
  id: string;
  name: string;
  price: number;
  categoryId: string;
  categoryName: string;
  available: boolean;
  hasModifiers: boolean;
}

export interface UseVoiceAgentOptions {
  /** Token de sesión de mesa del comensal. */
  token: string | null;
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Se llama una vez con el catálogo `ref → id` que emite el servidor. */
  onCatalog?: (catalog: VoiceCatalogEntry[]) => void;
}

export interface UseVoiceAgentResult {
  state: VoiceState;
  transcript: string;
  /** Lo último que dijo el COMENSAL, transcrito. Vacío hasta que hable. */
  userTranscript: string;
  error: string | null;
  outputLevel: number;
  /**
   * Amplitud de la voz del COMENSAL, 0–1.
   *
   * Es lo único que le dice que el micrófono le está oyendo. Sin esto, hablarle
   * a la pantalla es hablarle a algo que parece apagado.
   */
  inputLevel: number;
  /** Proveedor que atendió la conversación; útil para depurar en el local. */
  provider: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentResult {
  const { token, onToolCall, onCatalog } = options;

  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [userTranscript, setUserTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outputLevel, setOutputLevel] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [provider, setProvider] = useState<string | null>(null);

  const handleRef = useRef<VoiceTransportHandle | null>(null);
  const connectingRef = useRef(false);

  // Las funciones se leen por referencia para que reconectar no dependa de que
  // el llamador memoice sus callbacks.
  const onToolCallRef = useRef(onToolCall);
  const onCatalogRef = useRef(onCatalog);
  useEffect(() => {
    onToolCallRef.current = onToolCall;
    onCatalogRef.current = onCatalog;
  }, [onToolCall, onCatalog]);

  const cleanup = useCallback(() => {
    handleRef.current?.close();
    handleRef.current = null;
    connectingRef.current = false;
    setOutputLevel(0);
    setInputLevel(0);
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
    setState("idle");
    setTranscript("");
  }, [cleanup]);

  const connect = useCallback(async () => {
    if (!token) {
      setError("Necesitas una sesión de mesa activa");
      setState("error");
      return;
    }
    if (handleRef.current || connectingRef.current) return;

    connectingRef.current = true;
    setState("connecting");
    setError(null);
    setTranscript("");

    try {
      // 1. Credencial efímera. La clave del proveedor no sale del servidor.
      const res = await fetch(`${API_URL}/api/voice/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error?.message || "No se pudo iniciar el asistente de voz");
      }

      const data = payload.data as VoiceGrant & { catalog: VoiceCatalogEntry[] };
      onCatalogRef.current?.(data.catalog);
      setProvider(data.provider);

      const callbacks = {
        onState: setState,
        onTranscriptDelta: (delta: string) => setTranscript((prev) => prev + delta),
        // La voz del comensal SUSTITUYE, no acumula: llega la frase entera de
        // una vez y lo que dijo hace dos turnos ya no ayuda a nadie.
        onUserTranscript: (text: string) => setUserTranscript(text),
        onTranscriptReset: () => setTranscript(""),
        onLevel: setOutputLevel,
        onInputLevel: setInputLevel,
        onToolCall: (name: string, args: Record<string, unknown>) =>
          onToolCallRef.current(name, args),
        onError: (message: string) => {
          setError(message);
          setState("error");
        },
      };

      // 2. El transporte lo decide el servidor, no el navegador: así una tablet
      //    con la pestaña abierta desde antes de cambiar de proveedor no intenta
      //    hablar el protocolo que ya no toca.
      const grant: VoiceGrant = {
        clientSecret: data.clientSecret,
        model: data.model,
        voice: data.voice,
        provider: data.provider,
        transport: data.transport,
        connection: data.connection ?? {},
      };

      handleRef.current =
        grant.transport === "gemini-live"
          ? await connectGemini(grant, callbacks)
          : await connectOpenAI(grant, callbacks);

      connectingRef.current = false;
    } catch (err) {
      cleanup();
      // NotAllowedError = el comensal rechazó el micrófono. Merece un mensaje
      // que diga qué hacer, no un error genérico.
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setError(
        denied
          ? "Necesito permiso para usar el micrófono"
          : err instanceof Error
            ? err.message
            : "No se pudo iniciar el asistente",
      );
      setState("error");
    }
  }, [token, cleanup]);

  // Colgar al desmontar: una tablet que cambia de pantalla con la conexión
  // abierta sigue facturando audio.
  useEffect(() => cleanup, [cleanup]);

  return {
    state,
    transcript,
    userTranscript,
    error,
    outputLevel,
    inputLevel,
    provider,
    connect,
    disconnect,
  };
}
