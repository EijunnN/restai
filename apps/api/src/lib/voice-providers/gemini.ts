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
 * Adaptador de la Live API de Gemini (WebSocket + PCM).
 *
 * ── En qué se diferencia de OpenAI ───────────────────────────────────────────
 * No hay WebRTC: la sesión es un WebSocket por el que viaja audio PCM crudo en
 * base64 (16 kHz de entrada, 24 kHz de salida). El trabajo que en OpenAI hace el
 * navegador —captura, remuestreo, jitter, reproducción— aquí lo hacemos
 * nosotros, en `lib/voice-transport/gemini-live.ts`.
 *
 * ── Dónde queda el prompt ────────────────────────────────────────────────────
 * En el token, vía `liveConnectConstraints`, que es justo lo que Google
 * recomienda para "mantener las instrucciones del sistema en el servidor". El
 * cliente abre la conexión contra el endpoint `...Constrained` y manda un setup
 * MÍNIMO: no lleva ni el prompt ni las herramientas, así que no hay nada que
 * reescribir desde las herramientas de desarrollo del navegador.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_WS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-live-preview";
export const DEFAULT_GEMINI_VOICE = "Puck";

/** Frecuencias que exige la Live API. No son configurables. */
export const GEMINI_INPUT_SAMPLE_RATE = 16_000;
export const GEMINI_OUTPUT_SAMPLE_RATE = 24_000;

/**
 * Traduce un JSON Schema al subconjunto de OpenAPI que acepta Gemini.
 *
 * Dos diferencias que rompen la llamada si no se corrigen:
 *  - `type` va en MAYÚSCULAS (`STRING`, `OBJECT`, `ARRAY`…).
 *  - No admite validadores numéricos como `minimum`/`maximum`; si llegan, la
 *    declaración entera se rechaza y el agente se queda sin esa herramienta.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const input = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    // Validadores que Gemini no reconoce. El rango real ya lo comprueba el
    // cliente al ejecutar la herramienta, así que no se pierde nada.
    if (key === "minimum" || key === "maximum") continue;

    if (key === "type" && typeof value === "string") {
      out.type = value.toUpperCase();
    } else if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, prop]) => [
          name,
          toGeminiSchema(prop),
        ]),
      );
    } else if (key === "items") {
      out.items = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }

  return out;
}

function toGeminiTools(tools: VoiceToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((tool) => {
        const params = toGeminiSchema(tool.parameters) as Record<string, unknown>;
        const properties = params.properties as Record<string, unknown> | undefined;
        return {
          name: tool.name,
          description: tool.description,
          // Una función SIN parámetros no puede declarar un objeto vacío:
          // Gemini rechaza `{type:"OBJECT", properties:{}}`. Se omite el campo.
          ...(properties && Object.keys(properties).length > 0 ? { parameters: params } : {}),
        };
      }),
    },
  ];
}

/** ISO-8601 a N minutos vista, que es como Gemini expresa la caducidad. */
function isoIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export const geminiProvider: VoiceProvider = {
  id: "gemini",
  transport: "gemini-live",

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY);
  },

  model() {
    return process.env.VOICE_AGENT_MODEL || DEFAULT_GEMINI_MODEL;
  },

  voice() {
    return process.env.VOICE_AGENT_VOICE || DEFAULT_GEMINI_VOICE;
  },

  async createSession(request: VoiceSessionRequest): Promise<VoiceSessionGrant> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new VoiceProviderError("GEMINI_API_KEY no configurada", 503);

    const model = this.model();
    const voice = this.voice();
    // El modelo se referencia con el prefijo `models/` en toda la Live API.
    const qualifiedModel = model.startsWith("models/") ? model : `models/${model}`;

    const data = (await requestCredential({
      url: `${GEMINI_BASE}/auth_tokens`,
      headers: { "x-goog-api-key": key },
      providerId: "gemini",
      logger,
      body: {
        // Un solo uso: el token abre ESTA conversación y nada más.
        uses: 1,
        // Ventana corta para abrir la sesión; una vez abierta, aguanta el rato
        // que dure la conversación (el tope de gasto lo pone nuestra ruta).
        newSessionExpireTime: isoIn(2),
        expireTime: isoIn(30),
        // ── OJO con el nombre de este campo ──────────────────────────────
        // Los SDK de Google lo llaman `liveConnectConstraints`, pero la API
        // REST lo llama `bidiGenerateContentSetup` y rechaza el otro nombre con
        // un 400. Verificado contra la API real: un mock de `fetch` no detecta
        // esto, porque comprueba la forma que TÚ crees, no la de Google.
        bidiGenerateContentSetup: {
          model: qualifiedModel,
          // `responseModalities` y `speechConfig` van DENTRO de
          // `generationConfig`. Al nivel raíz devuelve "Unknown name".
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              languageCode: "es-US",
            },
          },
          systemInstruction: { parts: [{ text: request.instructions }] },
          tools: toGeminiTools(request.tools),
          // Sin esto no hay subtítulos: los deltas de transcripción de la voz
          // del agente son la mitad de la sincronía con la pantalla.
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
      },
    })) as { name?: string; token?: { name?: string } };

    // La respuesta trae el token en `name`; algunas versiones lo anidan.
    const token = data.name ?? data.token?.name;
    if (!token) {
      throw new VoiceProviderError("Respuesta inesperada del proveedor de voz", 503);
    }

    return {
      clientSecret: token,
      expiresAt: null,
      model: qualifiedModel,
      voice,
      transport: "gemini-live",
      connection: {
        wsUrl: GEMINI_WS,
        inputSampleRate: GEMINI_INPUT_SAMPLE_RATE,
        outputSampleRate: GEMINI_OUTPUT_SAMPLE_RATE,
      },
    };
  },
};
