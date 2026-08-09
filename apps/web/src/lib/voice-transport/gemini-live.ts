"use client";

import {
  MIC_CONSTRAINTS,
  smoothLevel,
  type VoiceGrant,
  type VoiceTransportCallbacks,
  type VoiceTransportHandle,
} from "./types";

/**
 * Transporte de Gemini Live: WebSocket con PCM crudo.
 *
 * ── Por qué esto es mucho más largo que el de OpenAI ─────────────────────────
 * Gemini no usa WebRTC. Todo lo que allí resuelve el navegador —captura,
 * remuestreo, empaquetado, jitter, reproducción sin cortes— hay que hacerlo
 * aquí a mano:
 *
 *   micrófono (48 kHz float32) → remuestreo a 16 kHz → PCM16 → base64 → WS
 *   WS → base64 → PCM16 24 kHz → AudioBuffer → cola encadenada → altavoz
 *
 * La cola encadenada es lo que evita el defecto clásico de estas integraciones:
 * si cada trozo se reproduce "cuando llega", entre uno y otro se cuela un
 * silencio de milisegundos y la voz suena entrecortada. Aquí cada trozo se
 * programa exactamente donde acaba el anterior.
 */

/** Tasa de captura que exige la Live API. */
const INPUT_RATE = 16_000;
/** Tasa a la que responde. */
const OUTPUT_RATE = 24_000;
/** Trozos de ~64 ms: suficientemente pequeños para que el VAD reaccione. */
const WORKLET_FRAME = 1024;

/**
 * Worklet de captura.
 *
 * Va como cadena y se carga desde un Blob para no tener que servir un archivo
 * suelto desde /public: así el transporte es un módulo autocontenido.
 *
 * El remuestreo es por decimación lineal. Es más basto que un filtro
 * polifásico, pero la voz vive muy por debajo de los 8 kHz de Nyquist a 16 kHz
 * y el micrófono ya entrega la señal filtrada y con reducción de ruido.
 */
const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetRate;
    this.ratio = sampleRate / this.targetRate;
    this.buffer = [];
    this.position = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    // Decimación: se toma una muestra cada \`ratio\` posiciones, interpolando
    // linealmente entre las dos vecinas.
    while (this.position < channel.length) {
      const index = Math.floor(this.position);
      const frac = this.position - index;
      const a = channel[index];
      const b = index + 1 < channel.length ? channel[index + 1] : a;
      this.buffer.push(a + (b - a) * frac);
      this.position += this.ratio;
    }
    this.position -= channel.length;

    if (this.buffer.length >= ${WORKLET_FRAME}) {
      const frame = this.buffer.splice(0, ${WORKLET_FRAME});
      const pcm = new Int16Array(frame.length);
      for (let i = 0; i < frame.length; i++) {
        const s = Math.max(-1, Math.min(1, frame[i]));
        // Asimétrico a propósito: el rango de un int16 con signo va de -32768
        // a 32767, y usar 32768 en el positivo produce recorte audible.
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Por trozos: con un audio largo, aplicar el spread de una sola vez desborda
  // la pila de argumentos.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

export async function connectGemini(
  grant: VoiceGrant,
  cb: VoiceTransportCallbacks,
): Promise<VoiceTransportHandle> {
  const wsUrl = grant.connection.wsUrl as string;
  const outputRate = (grant.connection.outputSampleRate as number) || OUTPUT_RATE;
  const inputRate = (grant.connection.inputSampleRate as number) || INPUT_RATE;

  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const mic = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });

  // Dos contextos: la captura corre a la tasa nativa del dispositivo (el
  // worklet remuestrea), y la reproducción a los 24 kHz exactos en que responde
  // el modelo. Forzar un solo contexto obligaría a remuestrear también la
  // salida, con la pérdida de calidad que eso trae.
  const captureCtx = new Ctx();
  const playbackCtx = new Ctx({ sampleRate: outputRate });

  const workletUrl = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
  );
  await captureCtx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  const source = captureCtx.createMediaStreamSource(mic);
  const capture = new AudioWorkletNode(captureCtx, "capture-processor", {
    processorOptions: { targetRate: inputRate },
  });
  source.connect(capture);
  // El worklet no produce salida audible, pero el grafo tiene que terminar en
  // el destino para que el navegador lo mantenga vivo.
  const mute = captureCtx.createGain();
  mute.gain.value = 0;
  capture.connect(mute);
  mute.connect(captureCtx.destination);

  const ws = new WebSocket(`${wsUrl}?access_token=${encodeURIComponent(grant.clientSecret)}`);
  ws.binaryType = "arraybuffer";

  let closed = false;
  let setupComplete = false;

  // ── Reproducción encadenada ────────────────────────────────────────────────
  let playHead = 0;
  let level = 0;
  let levelRaf: number | null = null;
  const scheduled = new Set<AudioBufferSourceNode>();

  function enqueueAudio(pcm: Int16Array) {
    const frames = pcm.length;
    if (frames === 0) return;

    const buffer = playbackCtx.createBuffer(1, frames, outputRate);
    const channel = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < frames; i++) {
      const sample = pcm[i] / 0x8000;
      channel[i] = sample;
      sum += sample * sample;
    }

    // La amplitud del trozo alimenta el orbe. Se toma aquí porque es la voz del
    // agente; medir la salida del altavoz recogería también el ruido del local.
    const rms = Math.sqrt(sum / frames);
    const nodeLevel = Math.min(1, rms * 3.5);

    const node = playbackCtx.createBufferSource();
    node.buffer = buffer;
    node.connect(playbackCtx.destination);

    const now = playbackCtx.currentTime;
    // Si la cola se vació (o es el primer trozo), se arranca con un colchón
    // pequeño: programar en `now` exacto produce un chasquido.
    if (playHead < now) playHead = now + 0.03;
    node.start(playHead);
    playHead += buffer.duration;

    scheduled.add(node);
    node.onended = () => scheduled.delete(node);

    level = smoothLevel(level, nodeLevel);
    cb.onState("speaking");
  }

  /**
   * Barge-in: el comensal habla y el agente tiene que callar YA.
   *
   * Con audio ya programado en el futuro no basta con dejar de encolar: hay que
   * abortar lo que está en la cola. Sin esto el agente sigue hablando varios
   * segundos después de que lo interrumpan, que es exactamente la sensación de
   * "esto es una máquina" que se quiere evitar.
   */
  function stopPlayback() {
    for (const node of scheduled) {
      try {
        node.stop();
      } catch {
        // Ya había terminado por su cuenta.
      }
    }
    scheduled.clear();
    playHead = 0;
    level = 0;
    cb.onLevel(0);
  }

  function startLevelLoop() {
    const tick = () => {
      // Decae solo cuando no entran trozos nuevos, para que el orbe no se quede
      // encendido al terminar la frase.
      if (scheduled.size === 0) level = smoothLevel(level, 0);
      cb.onLevel(level);
      levelRaf = requestAnimationFrame(tick);
    };
    levelRaf = requestAnimationFrame(tick);
  }

  // ── Envío del micrófono ────────────────────────────────────────────────────
  capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    if (!setupComplete || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: toBase64(event.data),
            mimeType: `audio/pcm;rate=${inputRate}`,
          },
        },
      }),
    );
  };

  // ── Herramientas ───────────────────────────────────────────────────────────
  async function dispatchToolCalls(
    calls: { id?: string; name?: string; args?: Record<string, unknown> }[],
  ) {
    // Se responden TODAS en un solo mensaje: la Live API es síncrona en las
    // llamadas a función y no vuelve a hablar hasta tenerlas contestadas.
    const responses = await Promise.all(
      calls.map(async (call) => {
        let output: unknown;
        try {
          output = await cb.onToolCall(String(call.name ?? ""), call.args ?? {});
        } catch (err) {
          output = { error: err instanceof Error ? err.message : "Error inesperado" };
        }
        return {
          id: call.id,
          name: call.name,
          // Gemini exige un OBJETO en `response`; un valor suelto se rechaza.
          response: { result: output ?? { ok: true } },
        };
      }),
    );

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
    }
  }

  function handleMessage(raw: string) {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      setupComplete = true;
      cb.onState("listening");
      startLevelLoop();
      return;
    }

    if (msg.toolCall?.functionCalls?.length) {
      void dispatchToolCalls(msg.toolCall.functionCalls);
      return;
    }

    const server = msg.serverContent;
    if (!server) return;

    // El comensal cortó al agente.
    if (server.interrupted) {
      stopPlayback();
      cb.onState("listening");
      cb.onTranscriptReset();
      return;
    }

    if (server.outputTranscription?.text) {
      cb.onState("speaking");
      cb.onTranscriptDelta(server.outputTranscription.text);
    }

    // Que el comensal empiece a hablar es la señal de turno nuevo: los
    // subtítulos del turno anterior dejan de tener sentido en pantalla.
    // Su texto, además, se emite: antes se descartaba aquí mismo y la pantalla
    // nunca podía enseñar lo que el comensal acababa de decir.
    if (server.inputTranscription?.text) {
      cb.onTranscriptReset();
      cb.onUserTranscript?.(server.inputTranscription.text);
    }

    for (const part of server.modelTurn?.parts ?? []) {
      const data = part?.inlineData?.data;
      if (typeof data === "string" && data.length > 0) {
        enqueueAudio(fromBase64(data));
      }
    }

    if (server.turnComplete) {
      cb.onState("listening");
    }
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("El asistente no respondió a tiempo")), 15_000);

    ws.addEventListener("open", () => {
      // Setup MÍNIMO: el modelo, las instrucciones y las herramientas ya vienen
      // fijados dentro del token (liveConnectConstraints), así que no viajan por
      // aquí y nadie puede reescribirlos desde el navegador.
      ws.send(JSON.stringify({ setup: { model: grant.model } }));
      clearTimeout(timeout);
      resolve();
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("No se pudo conectar con el asistente"));
    });
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      handleMessage(event.data);
    } else if (event.data instanceof ArrayBuffer) {
      // Algunos despliegues entregan los marcos como binario.
      handleMessage(new TextDecoder().decode(event.data));
    } else if (event.data instanceof Blob) {
      void event.data.text().then(handleMessage);
    }
  });

  ws.addEventListener("close", () => {
    if (!closed) cb.onError("Se perdió la conexión con el asistente");
  });

  return {
    close() {
      closed = true;
      if (levelRaf !== null) cancelAnimationFrame(levelRaf);
      stopPlayback();
      capture.port.onmessage = null;
      try {
        ws.close();
      } catch {
        // Ya estaba cerrado.
      }
      capture.disconnect();
      source.disconnect();
      mic.getTracks().forEach((t) => t.stop());
      void captureCtx.close().catch(() => {});
      void playbackCtx.close().catch(() => {});
    },
  };
}
