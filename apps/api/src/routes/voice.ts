import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@restai/db";
import type { AppEnv } from "../types.js";
import { customerAuth, requireActiveSession } from "../middleware/customer-auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { redis, redisSupported, intentarRedis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import {
  activeVoiceProvider,
  voiceAgentEnabled,
  VoiceProviderError,
} from "../lib/voice-providers/index.js";
import { buildVoiceAgentContext } from "../services/voice-agent.service.js";

/**
 * Mesero por voz.
 *
 * Esta ruta hace UNA cosa: entregar a la tablet una credencial efímera con la
 * carta y las instrucciones ya cocinadas dentro. El audio no pasa por aquí —la
 * tablet habla directamente con el proveedor por WebRTC—, y las acciones que
 * el agente decide (agregar al carrito, enviar el pedido) entran por los
 * endpoints de comensal de siempre, con sus mismas validaciones. El agente no
 * tiene un camino privilegiado a la base de datos.
 */
const voice = new Hono<AppEnv>();

/**
 * Tope de minutos de conversación por sesión de mesa.
 *
 * Sin esto, una tablet que se queda hablando sola —el caso real: el comensal se
 * va y el micro sigue captando el ruido del local— factura toda la noche. El
 * contador se lleva por sesión de mesa, que es la unidad que se cierra sola al
 * levantarse la mesa.
 */
const DEFAULT_MAX_MINUTES = 15;
/** Duración nominal que se imputa a cada credencial acuñada. */
const MINUTES_PER_GRANT = 5;

function maxMinutesPerSession(): number {
  const raw = Number(process.env.VOICE_AGENT_MAX_MINUTES_PER_SESSION);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_MINUTES;
}

/**
 * Consume presupuesto de voz para una sesión y dice si aún queda.
 *
 * Si Redis no está disponible se DEJA PASAR: el tope existe para acotar el
 * gasto, no para ser un control de seguridad, y caerse a "nadie puede hablar"
 * porque Redis está reiniciando sería un remedio peor que la enfermedad. La
 * misma decisión que toma el rate limiter en su fallback.
 */
async function consumeVoiceBudget(sessionId: string): Promise<{ ok: boolean; remainingMinutes: number }> {
  const max = maxMinutesPerSession();
  if (!redisSupported) return { ok: true, remainingMinutes: max };

  const key = `voice:budget:${sessionId}`;
  /*
    Sin bloquear: con Redis caido esta llamada esperaba los reintentos de
    ioredis y el comensal se quedaba mirando la pantalla antes de poder hablar.
    Si no hay respuesta se concede el minuto — el presupuesto es una salvaguarda
    de coste, no una puerta de seguridad, y negar el servicio porque la cache no
    esta seria peor que gastar de mas.
  */
  const gastado = await intentarRedis(async () => {
    const spent = await redis.incrby(key, MINUTES_PER_GRANT);
    // La sesión de mesa vive como mucho unas horas; la clave se va sola.
    if (spent === MINUTES_PER_GRANT) {
      await redis.expire(key, 6 * 60 * 60);
    }
    return spent;
  });

  try {
    if (gastado === null) throw new Error("Redis no disponible");
    if (gastado > max) {
      return { ok: false, remainingMinutes: 0 };
    }
    return { ok: true, remainingMinutes: max - gastado };
  } catch (err) {
    logger.warn("Voice budget check skipped (Redis unavailable)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: true, remainingMinutes: max };
  }
}

/**
 * GET /api/voice/config — ¿pinta el botón de hablar?
 *
 * Público a propósito: solo dice si la función existe en este despliegue, que
 * es justo lo que la pantalla necesita saber ANTES de tener sesión de mesa (el
 * modo tablet de pared arranca sin ella). No expone nada más.
 */
voice.get("/config", (c) => {
  const enabled = voiceAgentEnabled();
  const provider = enabled ? activeVoiceProvider() : null;
  return c.json({
    success: true,
    data: {
      enabled,
      provider: provider?.id ?? null,
      model: provider?.model() ?? null,
      voice: provider?.voice() ?? null,
      maxMinutesPerSession: maxMinutesPerSession(),
    },
  });
});

/**
 * POST /api/voice/session — credencial efímera para la tablet.
 *
 * El limitador va por identidad (el token de comensal), no por IP: en un local
 * todas las tablets salen por la misma IP pública y un cubo por IP las
 * bloquearía entre sí. Un tope holgado por sesión basta, porque el gasto real
 * ya lo acota el presupuesto de minutos.
 */
voice.post(
  "/session",
  customerAuth,
  requireActiveSession,
  rateLimiter(12, 60_000, "voice-session"),
  async (c) => {
    const user = c.get("user") as any;
    const session = c.get("session") as any;

    if (!voiceAgentEnabled()) {
      return c.json(
        {
          success: false,
          error: {
            code: "VOICE_DISABLED",
            message: "El mesero por voz no está disponible en este local",
          },
        },
        503,
      );
    }

    const budget = await consumeVoiceBudget(session.id);
    if (!budget.ok) {
      return c.json(
        {
          success: false,
          error: {
            code: "VOICE_BUDGET_EXCEEDED",
            message: "Se agotó el tiempo de atención por voz de esta mesa. Puedes seguir pidiendo desde la carta.",
          },
        },
        429,
      );
    }

    const [branch] = await db
      .select({
        id: schema.branches.id,
        name: schema.branches.name,
        currency: schema.branches.currency,
        is_active: schema.branches.is_active,
      })
      .from(schema.branches)
      .where(
        and(
          eq(schema.branches.id, user.branch),
          eq(schema.branches.organization_id, user.org),
        ),
      )
      .limit(1);

    if (!branch || !branch.is_active) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
        404,
      );
    }

    const context = await buildVoiceAgentContext({
      organizationId: user.org,
      branchId: user.branch,
      branchName: branch.name,
      currency: branch.currency,
      customerName: session.customer_name,
      tableNumber: session.table_number,
    });

    if (context.catalog.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "EMPTY_MENU",
            message: "La carta de este local aún no está publicada",
          },
        },
        409,
      );
    }

    const provider = activeVoiceProvider();
    if (!provider) {
      return c.json(
        {
          success: false,
          error: { code: "VOICE_DISABLED", message: "El mesero por voz no está disponible" },
        },
        503,
      );
    }

    let grant;
    try {
      grant = await provider.createSession({
        instructions: context.instructions,
        tools: context.tools,
        // La sesión de mesa es un uuid rotatorio, no identifica a una persona:
        // sirve al proveedor para correlacionar abuso sin que le mandemos datos
        // personales del comensal.
        safetyIdentifier: `session_${session.id}`,
      });
    } catch (err) {
      if (err instanceof VoiceProviderError) {
        return c.json(
          { success: false, error: { code: "VOICE_UNAVAILABLE", message: err.message } },
          err.status as 429 | 503,
        );
      }
      throw err;
    }

    return c.json({
      success: true,
      data: {
        clientSecret: grant.clientSecret,
        expiresAt: grant.expiresAt,
        model: grant.model,
        voice: grant.voice,
        // El cliente elige transporte con esto: WebRTC y WebSocket+PCM no se
        // parecen en nada, y fingir que sí saldría peor que decirlo.
        provider: provider.id,
        transport: grant.transport,
        connection: grant.connection,
        remainingMinutes: budget.remainingMinutes,
        catalog: context.catalog,
      },
    });
  },
);

export { voice };
