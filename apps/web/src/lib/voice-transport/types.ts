"use client";

/**
 * Transporte de la conversación de voz.
 *
 * Cada proveedor habla lo suyo —OpenAI va por WebRTC, Gemini por WebSocket con
 * PCM crudo— y esa diferencia no se puede disimular: son dos formas distintas
 * de mover audio. Lo que sí es idéntico es lo que el resto de la aplicación
 * necesita saber de la conversación, y eso es lo que fija esta interfaz.
 *
 * Todo lo de arriba (herramientas, pantalla, subtítulos) es agnóstico.
 */

export type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface VoiceGrant {
  clientSecret: string;
  model: string;
  voice: string;
  provider: string;
  transport: "openai-webrtc" | "gemini-live";
  connection: Record<string, unknown>;
}

export interface VoiceTransportCallbacks {
  onState: (state: VoiceState) => void;
  /** Trozo de lo que el agente está diciendo, según llega. */
  onTranscriptDelta: (delta: string) => void;
  /**
   * Lo que ha dicho el COMENSAL, ya transcrito.
   *
   * Va por su propio canal y no mezclado con el del agente: en pantalla son dos
   * voces distintas y hay que poder distinguirlas. Sin esto, el comensal habla
   * y no ve ninguna prueba de que se le entendió —solo la respuesta, que puede
   * ser correcta por casualidad—.
   */
  onUserTranscript?: (text: string) => void;
  /** Empieza un turno nuevo: los subtítulos se vacían. */
  onTranscriptReset: () => void;
  /** Amplitud de la voz del agente, 0–1. */
  onLevel: (level: number) => void;
  /**
   * Amplitud de la voz del COMENSAL, 0–1.
   *
   * Va por su propio canal porque en pantalla son dos cosas distintas: la del
   * agente mueve su presencia, y esta es la única prueba que tiene el comensal
   * de que el micrófono le está oyendo. Sin ella, hablar a una pantalla quieta
   * es hablarle a algo que parece apagado, y la reacción natural es repetir más
   * alto o rendirse.
   */
  onInputLevel?: (level: number) => void;
  /**
   * Ejecuta una herramienta. DEBE resolver siempre: si lanza, el modelo se
   * queda esperando una respuesta que no llega y la conversación se congela a
   * media frase.
   */
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onError: (message: string) => void;
}

export interface VoiceTransportHandle {
  close: () => void;
}

export type VoiceTransportConnect = (
  grant: VoiceGrant,
  callbacks: VoiceTransportCallbacks,
) => Promise<VoiceTransportHandle>;

/**
 * Restricciones del micrófono, iguales para los dos transportes.
 *
 * Las tres son obligatorias y ninguna es cosmética: la tablet reproduce por
 * altavoz y capta por micro a la vez, así que sin cancelación de eco el agente
 * se oye a sí mismo, cree que le hablan y se interrumpe solo en bucle.
 */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Suavizado del medidor de amplitud.
 *
 * Sube rápido y baja despacio, como el cuerpo de una voz. Sin esto el orbe
 * tiembla en vez de respirar.
 */
export function smoothLevel(previous: number, target: number): number {
  const clamped = Math.min(1, target);
  return clamped > previous ? previous + (clamped - previous) * 0.45 : previous * 0.88;
}

/**
 * Amplitud (0–1) de un bloque de PCM de 16 bits con signo.
 *
 * Es la media cuadrática, no el pico: el pico salta con cualquier golpe de mesa
 * y deja la pantalla dando tirones, mientras que la media sigue el cuerpo de la
 * voz. El factor 3.5 es el mismo que usa el medidor del agente, para que las
 * dos voces se muevan en la misma escala y una no parezca el doble de fuerte
 * que la otra.
 */
export function pcmLevel(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let suma = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]! / 32768;
    suma += v * v;
  }
  return Math.min(1, Math.sqrt(suma / pcm.length) * 3.5);
}
