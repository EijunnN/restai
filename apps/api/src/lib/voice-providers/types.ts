/**
 * Puerto del proveedor de voz.
 *
 * Mismo patrón que `RealtimePublisher` (ver docs/REALTIME.md): el dominio solo
 * conoce esta interfaz y los adaptadores concretos se eligen por entorno con
 * `VOICE_AGENT_PROVIDER`. Cambiar de proveedor no toca el prompt, ni las
 * herramientas, ni la pantalla.
 *
 * Lo que NO abstrae, a propósito: el transporte. OpenAI habla WebRTC y Gemini
 * WebSocket con PCM crudo; fingir que son lo mismo obligaría a un denominador
 * común peor que ambos. El puerto abstrae la CREDENCIAL y la CONFIGURACIÓN, y
 * le dice al cliente qué transporte le toca usar.
 */

/** Herramienta en formato neutro. Cada adaptador la traduce a su dialecto. */
export interface VoiceToolDefinition {
  name: string;
  description: string;
  /** JSON Schema de objeto. Los adaptadores recortan lo que su API no admita. */
  parameters: Record<string, unknown>;
}

export type VoiceTransport = "openai-webrtc" | "gemini-live";

export interface VoiceSessionRequest {
  instructions: string;
  tools: VoiceToolDefinition[];
  /** Identificador estable y NO personal, para la telemetría de abuso. */
  safetyIdentifier?: string;
}

export interface VoiceSessionGrant {
  /** La credencial efímera. Es lo único que viaja a la tablet. */
  clientSecret: string;
  expiresAt: number | null;
  model: string;
  voice: string;
  transport: VoiceTransport;
  /**
   * Datos que el transporte del cliente necesita para conectar (URL del
   * WebSocket, frecuencias de muestreo…). Nunca credenciales de la cuenta.
   */
  connection: Record<string, unknown>;
}

export interface VoiceProvider {
  readonly id: string;
  readonly transport: VoiceTransport;
  /** ¿Está configurado y utilizable en este despliegue? */
  isConfigured(): boolean;
  model(): string;
  voice(): string;
  createSession(request: VoiceSessionRequest): Promise<VoiceSessionGrant>;
}

/** Error del proveedor, con el código HTTP para poder traducirlo a una respuesta. */
export class VoiceProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VoiceProviderError";
  }
}

/**
 * Realiza la petición de credencial con tope temporal y errores homogéneos.
 *
 * Compartido por los adaptadores porque el modo de fallar debe ser idéntico se
 * use quien se use: sin tope, un cuelgue del proveedor deja al comensal mirando
 * una pantalla muda; y el detalle del error jamás puede salir hacia la tablet.
 */
export async function requestCredential(params: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  providerId: string;
  logger: { error: (msg: string, meta?: Record<string, unknown>) => void };
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let res: Response;
  try {
    res = await fetch(params.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...params.headers },
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    params.logger.error("Voice credential request failed", {
      provider: params.providerId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new VoiceProviderError(
      aborted
        ? "El proveedor de voz no respondió a tiempo"
        : "No se pudo contactar al proveedor de voz",
      503,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // El cuerpo puede traer detalles del proveedor: se registran para depurar,
    // pero NO se devuelven al comensal. Un 401 del proveedor es un problema
    // NUESTRO de configuración; traducirlo tal cual sugeriría al comensal que su
    // sesión es inválida.
    const detail = await res.text().catch(() => "");
    params.logger.error("Voice credential rejected", {
      provider: params.providerId,
      status: res.status,
      detail: detail.slice(0, 500),
    });
    const status = res.status === 429 ? 429 : 503;
    throw new VoiceProviderError(
      status === 429
        ? "El servicio de voz está saturado, intenta en un momento"
        : "El servicio de voz no está disponible",
      status,
    );
  }

  return res.json();
}
