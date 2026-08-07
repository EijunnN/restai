"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Transporte del mesero por voz.
 *
 * Este hook NO sabe qué hace el agente: solo mantiene la conversación viva
 * (audio en los dos sentidos, transcripción y llamadas a herramientas) y
 * delega cada herramienta en `onToolCall`. Toda la lógica de restaurante vive
 * en `lib/voice-tools.ts`; así el día que cambie el proveedor de voz se
 * reescribe este archivo y las herramientas siguen intactas.
 *
 * El audio va por WebRTC directamente al proveedor: no pasa por nuestra API.
 * Lo único que nuestro backend entrega es una credencial efímera ya cargada con
 * la carta y las instrucciones (ver `apps/api/src/routes/voice.ts`).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

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
  /**
   * Ejecuta una herramienta y devuelve lo que se le contestará al modelo.
   * Debe resolver SIEMPRE (los errores se devuelven como dato, no se lanzan):
   * si una herramienta lanza, el modelo se queda esperando y la conversación
   * se congela a media frase.
   */
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Se llama una vez con el catálogo `ref → id` que emite el servidor. */
  onCatalog?: (catalog: VoiceCatalogEntry[]) => void;
}

export interface UseVoiceAgentResult {
  state: VoiceState;
  /** Lo que el agente está diciendo ahora mismo, palabra a palabra. */
  transcript: string;
  error: string | null;
  /** Amplitud de la voz del agente (0–1). Alimenta las animaciones. */
  outputLevel: number;
  connect: () => Promise<void>;
  disconnect: () => void;
}

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentResult {
  const { token, onToolCall, onCatalog } = options;

  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outputLevel, setOutputLevel] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  /**
   * Herramientas ya despachadas, por `call_id`.
   *
   * El mismo `function_call` llega DOS veces: primero en
   * `response.function_call_arguments.done` y otra vez dentro de
   * `response.done`. Nos interesa el primero —llega antes de que el agente
   * termine de hablar, que es justo lo que hace que la pantalla vaya con la
   * voz y no detrás—, pero hay que recordar cuál ya se atendió o el pedido se
   * duplicaría.
   */
  const handledCallsRef = useRef<Set<string>>(new Set());

  // Las opciones se leen por referencia para que reconectar no dependa de que
  // el llamador memoice sus callbacks.
  const onToolCallRef = useRef(onToolCall);
  const onCatalogRef = useRef(onCatalog);
  useEffect(() => {
    onToolCallRef.current = onToolCall;
    onCatalogRef.current = onCatalog;
  }, [onToolCall, onCatalog]);

  const send = useCallback((event: RealtimeEvent) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(JSON.stringify(event));
  }, []);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    handledCallsRef.current.clear();
    setOutputLevel(0);
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
    setState("idle");
    setTranscript("");
  }, [cleanup]);

  /**
   * Medidor de amplitud de la voz del agente.
   *
   * De aquí sale el latido del orbe. Se mide la señal REMOTA (lo que dice el
   * agente), no el micrófono: es su voz la que debe mover la imagen.
   *
   * El nodo de ganancia a cero es necesario, no decorativo: en varios
   * navegadores un MediaStream de WebRTC no bombea muestras al analizador si
   * el grafo no termina en el destino. Con ganancia 0 el grafo corre pero no
   * suena dos veces (el audio real lo reproduce el elemento <audio>).
   */
  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(ctx.destination);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;

      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        // Suavizado exponencial: sin él el orbe tiembla en vez de respirar.
        // Sube rápido y baja despacio, como el cuerpo de una voz.
        const target = Math.min(1, rms * 3.5);
        smoothed = target > smoothed ? smoothed + (target - smoothed) * 0.45 : smoothed * 0.88;
        setOutputLevel(smoothed);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Sin medidor la conversación funciona igual; solo se pierde el latido.
    }
  }, []);

  /** Ejecuta una herramienta y devuelve el resultado al modelo. */
  const dispatchTool = useCallback(
    async (callId: string, name: string, rawArgs: string) => {
      if (handledCallsRef.current.has(callId)) return;
      handledCallsRef.current.add(callId);

      let args: Record<string, unknown> = {};
      try {
        args = rawArgs ? JSON.parse(rawArgs) : {};
      } catch {
        args = {};
      }

      let output: unknown;
      try {
        output = await onToolCallRef.current(name, args);
      } catch (err) {
        // Nunca se propaga: el modelo necesita SIEMPRE una respuesta, aunque
        // sea un error, o se queda callado esperando para siempre.
        output = {
          error: err instanceof Error ? err.message : "Error inesperado",
        };
      }

      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output ?? { ok: true }),
        },
      });
      send({ type: "response.create" });
    },
    [send],
  );

  const handleEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case "input_audio_buffer.speech_started":
          // El comensal tomó la palabra: el agente calla solo (barge-in lo
          // gestiona el proveedor) y la pantalla vuelve a modo escucha.
          setState("listening");
          setTranscript("");
          break;

        case "input_audio_buffer.speech_stopped":
          setState("thinking");
          break;

        case "response.output_audio_transcript.delta": {
          const delta = typeof event.delta === "string" ? event.delta : "";
          if (delta) {
            setState("speaking");
            setTranscript((prev) => prev + delta);
          }
          break;
        }

        case "response.output_audio_transcript.done":
          if (typeof event.transcript === "string") setTranscript(event.transcript);
          break;

        // Llega en cuanto el modelo termina de escribir los argumentos, ANTES
        // de acabar la frase que los acompaña. Despachar aquí es lo que hace
        // que el plato aparezca mientras lo nombra.
        case "response.function_call_arguments.done": {
          const callId = String(event.call_id ?? "");
          const name = String(event.name ?? "");
          const args = typeof event.arguments === "string" ? event.arguments : "{}";
          if (callId && name) void dispatchTool(callId, name, args);
          break;
        }

        case "response.done": {
          // Red de seguridad: si algún `function_call` no pasó por el evento
          // anterior, se atiende aquí. `handledCallsRef` evita repetirlo.
          const response = event.response as { output?: unknown[] } | undefined;
          for (const item of response?.output ?? []) {
            const call = item as { type?: string; call_id?: string; name?: string; arguments?: string };
            if (call.type === "function_call" && call.call_id && call.name) {
              void dispatchTool(call.call_id, call.name, call.arguments ?? "{}");
            }
          }
          setState((prev) => (prev === "speaking" ? "listening" : prev));
          break;
        }

        case "error": {
          const err = event.error as { message?: string } | undefined;
          setError(err?.message || "El asistente tuvo un problema");
          setState("error");
          break;
        }
      }
    },
    [dispatchTool],
  );

  const connect = useCallback(async () => {
    if (!token) {
      setError("Necesitas una sesión de mesa activa");
      setState("error");
      return;
    }
    if (pcRef.current) return;

    setState("connecting");
    setError(null);
    setTranscript("");

    try {
      // 1. Credencial efímera. La clave real de OpenAI nunca sale del servidor.
      const res = await fetch(`${API_URL}/api/voice/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error?.message || "No se pudo iniciar el asistente de voz");
      }
      const { clientSecret, catalog } = payload.data as {
        clientSecret: string;
        catalog: VoiceCatalogEntry[];
      };
      onCatalogRef.current?.(catalog);

      // 2. Micrófono. Las tres banderas son obligatorias, no cosméticas: la
      //    tablet reproduce por altavoz y capta por micro a la vez, así que sin
      //    cancelación de eco el agente se oye a sí mismo, cree que alguien le
      //    habla y se interrumpe solo en bucle.
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micRef.current = mic;

      // 3. Conexión.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        startLevelMeter(e.streams[0]);
      };

      pc.addTrack(mic.getTracks()[0], mic);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", (e) => {
        try {
          handleEvent(JSON.parse(e.data) as RealtimeEvent);
        } catch {
          // Un evento ilegible no debe tumbar la conversación.
        }
      });
      dc.addEventListener("open", () => {
        setState("listening");
        // El agente abre la conversación: si esperásemos a que hable el
        // comensal, la tablet parecería apagada.
        send({ type: "response.create" });
      });

      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setError("Se perdió la conexión con el asistente");
          setState("error");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) throw new Error("No se pudo establecer el audio");

      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
    } catch (err) {
      cleanup();
      // El navegador devuelve NotAllowedError cuando el comensal rechaza el
      // micrófono: merece un mensaje que diga qué hacer, no un error genérico.
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
  }, [token, cleanup, handleEvent, send, startLevelMeter]);

  // Colgar al desmontar: una tablet que cambia de pantalla con la conexión
  // abierta sigue facturando audio.
  useEffect(() => cleanup, [cleanup]);

  return { state, transcript, error, outputLevel, connect, disconnect };
}
