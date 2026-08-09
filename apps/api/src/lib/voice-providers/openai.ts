import { logger } from "../logger.js";
import {
  requestCredential,
  VoiceProviderError,
  type VoiceProvider,
  type VoiceSessionGrant,
  type VoiceSessionRequest,
  type VoiceToolDefinition,
} from "./types.js";

/**
 * Adaptador de la API Realtime de OpenAI (WebRTC).
 *
 * La configuración entera —instrucciones, herramientas y detección de turnos—
 * viaja DENTRO de la credencial efímera. Ni el prompt ni las herramientas pasan
 * por el navegador, así que nadie puede reescribirle al mesero lo que tiene
 * permitido hacer.
 */

const OPENAI_BASE = "https://api.openai.com/v1";

export const DEFAULT_OPENAI_MODEL = "gpt-realtime-2.1-mini";
export const DEFAULT_OPENAI_VOICE = "marin";

/** OpenAI acepta JSON Schema tal cual. */
function toOpenAITool(tool: VoiceToolDefinition) {
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

export const openaiProvider: VoiceProvider = {
  id: "openai",
  transport: "openai-webrtc",

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  model() {
    return process.env.VOICE_AGENT_MODEL || DEFAULT_OPENAI_MODEL;
  },

  voice() {
    return process.env.VOICE_AGENT_VOICE || DEFAULT_OPENAI_VOICE;
  },

  async createSession(request: VoiceSessionRequest): Promise<VoiceSessionGrant> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new VoiceProviderError("OPENAI_API_KEY no configurada", 503);

    const model = this.model();
    const voice = this.voice();

    const data = (await requestCredential({
      url: `${OPENAI_BASE}/realtime/client_secrets`,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(request.safetyIdentifier
          ? { "OpenAI-Safety-Identifier": request.safetyIdentifier }
          : {}),
      },
      providerId: "openai",
      logger,
      body: {
        session: {
          type: "realtime",
          model,
          instructions: request.instructions,
          tools: request.tools.map(toOpenAITool),
          tool_choice: "auto",
          audio: {
            input: {
              // `far_field` es el perfil correcto: la tablet está a un brazo de
              // distancia, no pegada a la boca. Con el perfil de cerca, el ruido
              // de un local lleno se cuela como si fuera habla.
              noise_reduction: { type: "far_field" },
              // VAD semántico: decide el fin de turno por el SENTIDO de la
              // frase, no por el silencio. En un comedor ruidoso el VAD por
              // energía corta al comensal cada vez que alguien ríe cerca.
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                // Barge-in: el comensal interrumpe y el agente calla.
                interrupt_response: true,
              },
            },
            output: { voice },
          },
        },
      },
    })) as { value?: string; expires_at?: number };

    if (!data.value) {
      throw new VoiceProviderError("Respuesta inesperada del proveedor de voz", 503);
    }

    return {
      clientSecret: data.value,
      expiresAt: data.expires_at ?? null,
      model,
      voice,
      transport: "openai-webrtc",
      connection: { callsUrl: `${OPENAI_BASE}/realtime/calls` },
    };
  },
};
