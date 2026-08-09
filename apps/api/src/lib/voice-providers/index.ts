import { openaiProvider } from "./openai.js";
import { geminiProvider } from "./gemini.js";
import type { VoiceProvider } from "./types.js";

export * from "./types.js";
export { openaiProvider } from "./openai.js";
export { geminiProvider } from "./gemini.js";

const PROVIDERS: Record<string, VoiceProvider> = {
  openai: openaiProvider,
  gemini: geminiProvider,
};

/**
 * Proveedor activo.
 *
 * `VOICE_AGENT_PROVIDER` manda; si no está puesto se autodetecta por la clave
 * disponible, con OpenAI primero por ser el que ya estaba en marcha. La
 * autodetección evita que quien solo tenga una clave tenga que aprenderse una
 * variable más — mismo criterio que el coordinador de `REALTIME_PROVIDER`.
 *
 * Se resuelve en CADA llamada, no al importar: en Cloudflare Workers
 * `process.env` se hidrata después de cargar los módulos.
 */
export function activeVoiceProvider(): VoiceProvider | null {
  const configured = process.env.VOICE_AGENT_PROVIDER?.trim().toLowerCase();
  if (configured) {
    const provider = PROVIDERS[configured];
    // Un nombre mal escrito debe notarse, no caer en silencio a otro proveedor
    // con otro precio y otra voz.
    if (!provider) return null;
    return provider.isConfigured() ? provider : null;
  }

  if (openaiProvider.isConfigured()) return openaiProvider;
  if (geminiProvider.isConfigured()) return geminiProvider;
  return null;
}

/** ¿Está el agente de voz utilizable en este despliegue? */
export function voiceAgentEnabled(): boolean {
  if (process.env.VOICE_AGENT_ENABLED === "false") return false;
  return activeVoiceProvider() !== null;
}
