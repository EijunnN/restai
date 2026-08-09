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
  /** Amplitud de la voz del agente, 0–1. Alimenta el orbe. */
  onLevel: (level: number) => void;
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
