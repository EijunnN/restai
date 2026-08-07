import { logger } from "./logger.js";

/**
 * Cliente del endpoint de credenciales efímeras de la API Realtime de OpenAI.
 *
 * ── Por qué existe este archivo ──────────────────────────────────────────────
 * La tablet NUNCA puede ver `OPENAI_API_KEY`: una clave de API da acceso a toda
 * la cuenta, y el navegador de un aparato colgado en la pared de un local es el
 * peor sitio posible para guardarla. El servidor acuña aquí un secreto de vida
 * corta ligado a UNA sesión, y es lo único que baja al dispositivo.
 *
 * Además es el único punto del backend que conoce a OpenAI. El día que se
 * cambie de proveedor de voz se reescribe este archivo y el servicio que arma
 * la configuración; ni las rutas ni la interfaz se enteran.
 */

const OPENAI_BASE = "https://api.openai.com/v1";

/** Modelo por defecto: la variante mini, ~5× más barata que la grande. */
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1-mini";
export const DEFAULT_REALTIME_VOICE = "marin";

/**
 * Lectura PEREZOSA de la clave.
 *
 * En Cloudflare Workers `process.env` se hidrata en `worker.ts → configure()`,
 * que corre DESPUÉS de importar los módulos. Leerla en el scope del módulo la
 * dejaría vacía para siempre en ese runtime (mismo motivo que en rate-limit.ts).
 */
function apiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || undefined;
}

/** ¿Está el agente de voz utilizable en este despliegue? */
export function voiceAgentEnabled(): boolean {
  if (process.env.VOICE_AGENT_ENABLED === "false") return false;
  return Boolean(apiKey());
}

export function realtimeModel(): string {
  return process.env.VOICE_AGENT_MODEL || DEFAULT_REALTIME_MODEL;
}

export function realtimeVoice(): string {
  return process.env.VOICE_AGENT_VOICE || DEFAULT_REALTIME_VOICE;
}

/** Error del proveedor, con el código HTTP para poder traducirlo a una respuesta. */
export class RealtimeProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RealtimeProviderError";
  }
}

export interface RealtimeToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface MintClientSecretParams {
  instructions: string;
  tools: RealtimeToolDefinition[];
  /** Identificador estable y NO personal para la telemetría de abuso de OpenAI. */
  safetyIdentifier?: string;
}

export interface EphemeralClientSecret {
  /** El secreto en sí. Es lo único que viaja a la tablet. */
  value: string;
  expiresAt: number | null;
  model: string;
  voice: string;
}

/**
 * Acuña un secreto efímero con la sesión ya configurada.
 *
 * La configuración va TODA aquí, en el servidor: instrucciones, herramientas y
 * detección de turnos. Si se enviara desde el navegador, cualquiera con las
 * herramientas de desarrollo podría reescribir el prompt del mesero y, por
 * ejemplo, pedirle que regale platos.
 */
export async function mintClientSecret(
  params: MintClientSecretParams,
): Promise<EphemeralClientSecret> {
  const key = apiKey();
  if (!key) {
    throw new RealtimeProviderError("OPENAI_API_KEY no configurada", 503);
  }

  const model = realtimeModel();
  const voice = realtimeVoice();

  const body = {
    session: {
      type: "realtime",
      model,
      instructions: params.instructions,
      tools: params.tools,
      tool_choice: "auto",
      audio: {
        input: {
          // `far_field` es el perfil correcto para este caso: la tablet está a
          // un brazo de distancia (o colgada en la pared), no pegada a la boca
          // como un móvil. Con el perfil de cerca, el ruido de fondo de un local
          // lleno se cuela como si fuera habla.
          noise_reduction: { type: "far_field" },
          // VAD semántico en vez de por volumen: decide el fin de turno por el
          // SENTIDO de la frase, no por el silencio. En un comedor ruidoso el
          // VAD por energía corta al comensal cada vez que alguien ríe cerca.
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: true,
            // Barge-in: el comensal interrumpe y el agente calla al instante.
            // Es la diferencia entre "hablar con alguien" y "esperar a la
            // máquina".
            interrupt_response: true,
          },
        },
        output: { voice },
      },
    },
  };

  // Sin tope temporal, un cuelgue del proveedor deja al comensal mirando una
  // pantalla que no dice nada.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let res: Response;
  try {
    res = await fetch(`${OPENAI_BASE}/realtime/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(params.safetyIdentifier
          ? { "OpenAI-Safety-Identifier": params.safetyIdentifier }
          : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logger.error("Realtime client secret request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new RealtimeProviderError(
      aborted ? "El proveedor de voz no respondió a tiempo" : "No se pudo contactar al proveedor de voz",
      503,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // El cuerpo del error puede traer detalles del proveedor; se registran para
    // depurar pero NO se devuelven al comensal tal cual.
    const detail = await res.text().catch(() => "");
    logger.error("Realtime client secret rejected", {
      status: res.status,
      detail: detail.slice(0, 500),
    });
    // 401/403 del proveedor es un problema NUESTRO de configuración, no del
    // comensal: se traduce a 503 para no sugerir que su sesión es inválida.
    const status = res.status === 429 ? 429 : 503;
    throw new RealtimeProviderError(
      status === 429
        ? "El servicio de voz está saturado, intenta en un momento"
        : "El servicio de voz no está disponible",
      status,
    );
  }

  const data = (await res.json()) as { value?: string; expires_at?: number };
  if (!data.value) {
    throw new RealtimeProviderError("Respuesta inesperada del proveedor de voz", 503);
  }

  return {
    value: data.value,
    expiresAt: data.expires_at ?? null,
    model,
    voice,
  };
}
