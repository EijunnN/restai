"use client";

import {
  MIC_CONSTRAINTS,
  smoothLevel,
  type VoiceGrant,
  type VoiceTransportCallbacks,
  type VoiceTransportHandle,
} from "./types";

/**
 * Transporte de OpenAI Realtime: WebRTC.
 *
 * El navegador negocia la llamada y se encarga de codificación, jitter y
 * reproducción. Nosotros solo escuchamos el canal de datos `oai-events`.
 */

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

export async function connectOpenAI(
  grant: VoiceGrant,
  cb: VoiceTransportCallbacks,
): Promise<VoiceTransportHandle> {
  const callsUrl =
    (grant.connection.callsUrl as string) || "https://api.openai.com/v1/realtime/calls";

  const mic = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
  const pc = new RTCPeerConnection();

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;

  let audioCtx: AudioContext | null = null;
  let raf: number | null = null;

  /**
   * Medidor de amplitud sobre la pista REMOTA: es la voz del agente la que debe
   * mover la imagen.
   *
   * El nodo de ganancia a cero no es decorativo: en varios navegadores un
   * MediaStream de WebRTC no bombea muestras al analizador si el grafo no
   * termina en el destino. Con ganancia 0 el grafo corre pero no suena dos
   * veces (el audio real lo reproduce el elemento <audio>).
   */
  function startLevelMeter(stream: MediaStream) {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Ctx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      const silent = audioCtx.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(audioCtx.destination);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let level = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        level = smoothLevel(level, Math.sqrt(sum / buffer.length) * 3.5);
        cb.onLevel(level);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      // Sin medidor la conversación funciona; solo se pierde el latido.
    }
  }

  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
    startLevelMeter(e.streams[0]);
  };
  pc.addTrack(mic.getTracks()[0], mic);

  const dc = pc.createDataChannel("oai-events");
  const send = (event: RealtimeEvent) => {
    if (dc.readyState === "open") dc.send(JSON.stringify(event));
  };

  /**
   * Herramientas ya despachadas, por `call_id`.
   *
   * El mismo `function_call` llega DOS veces: en
   * `response.function_call_arguments.done` y otra vez dentro de
   * `response.done`. Interesa el primero —llega antes de que el agente termine
   * de hablar, que es lo que hace que la pantalla vaya con la voz y no
   * detrás—, pero hay que recordar cuál se atendió o el pedido se duplicaría.
   */
  const handled = new Set<string>();

  async function dispatch(callId: string, name: string, rawArgs: string) {
    if (handled.has(callId)) return;
    handled.add(callId);

    let args: Record<string, unknown> = {};
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      args = {};
    }

    let output: unknown;
    try {
      output = await cb.onToolCall(name, args);
    } catch (err) {
      output = { error: err instanceof Error ? err.message : "Error inesperado" };
    }

    send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output ?? { ok: true }) },
    });
    send({ type: "response.create" });
  }

  dc.addEventListener("message", (e) => {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(e.data) as RealtimeEvent;
    } catch {
      return; // Un evento ilegible no debe tumbar la conversación.
    }

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        cb.onState("listening");
        cb.onTranscriptReset();
        break;
      case "input_audio_buffer.speech_stopped":
        cb.onState("thinking");
        break;
      // Lo que dijo el comensal, ya transcrito por completo. Llega una vez por
      // turno, no en trozos: se emite tal cual.
      case "conversation.item.input_audio_transcription.completed": {
        const texto = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (texto) cb.onUserTranscript?.(texto);
        break;
      }
      case "response.output_audio_transcript.delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta) {
          cb.onState("speaking");
          cb.onTranscriptDelta(delta);
        }
        break;
      }
      // Llega en cuanto el modelo termina de escribir los argumentos, ANTES de
      // acabar la frase que los acompaña: es lo que hace que el plato aparezca
      // mientras lo nombra.
      case "response.function_call_arguments.done": {
        const callId = String(event.call_id ?? "");
        const name = String(event.name ?? "");
        if (callId && name) {
          void dispatch(callId, name, typeof event.arguments === "string" ? event.arguments : "{}");
        }
        break;
      }
      case "response.done": {
        const response = event.response as { output?: unknown[] } | undefined;
        for (const item of response?.output ?? []) {
          const call = item as { type?: string; call_id?: string; name?: string; arguments?: string };
          if (call.type === "function_call" && call.call_id && call.name) {
            void dispatch(call.call_id, call.name, call.arguments ?? "{}");
          }
        }
        cb.onState("listening");
        break;
      }
      case "error": {
        const err = event.error as { message?: string } | undefined;
        cb.onError(err?.message || "El asistente tuvo un problema");
        break;
      }
    }
  });

  dc.addEventListener("open", () => {
    cb.onState("listening");
    // La transcripción de lo que dice el COMENSAL hay que pedirla: por defecto
    // el canal solo devuelve lo que habla el agente, y la pantalla no podía
    // enseñar prueba alguna de haber entendido bien.
    send({
      type: "session.update",
      session: { input_audio_transcription: { model: "whisper-1" } },
    });
    // El agente abre la conversación: si esperásemos a que hable el comensal,
    // la tablet parecería apagada.
    send({ type: "response.create" });
  });

  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      cb.onError("Se perdió la conexión con el asistente");
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(callsUrl, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${grant.clientSecret}`,
      "Content-Type": "application/sdp",
    },
  });
  if (!sdpRes.ok) throw new Error("No se pudo establecer el audio");

  await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

  return {
    close() {
      if (raf !== null) cancelAnimationFrame(raf);
      dc.close();
      pc.close();
      mic.getTracks().forEach((t) => t.stop());
      audioEl.srcObject = null;
      audioEl.remove();
      void audioCtx?.close().catch(() => {});
    },
  };
}
