import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { realtime } from "../infrastructure/container.js";
import { logger } from "../lib/logger.js";
import {
  peruCivilDayEnd,
  peruCivilDayStart,
  peruEndOfDay,
  peruStartOfDay,
} from "../lib/timezone.js";
import * as serviceRequestService from "../services/service-request.service.js";

/**
 * Avisos de mesa para el personal de sala.
 *
 * El comensal los crea desde su propia ruta (`/api/customer/table-action`);
 * aquí vive el otro lado: la bandeja del mozo, el "voy" y el "resuelto". Cada
 * transición se publica en el canal de la sede para que la campana de todas las
 * tablets se actualice sola, y en el canal de la sesión para que el comensal
 * vea que su llamada fue atendida.
 */
const serviceRequests = new Hono<AppEnv>();

serviceRequests.use("*", authMiddleware);
serviceRequests.use("*", tenantMiddleware);
serviceRequests.use("*", requireBranch);

// ── Esquemas (inline: este archivo no comparte validadores) ─────────

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const listQuerySchema = z.object({
  /**
   * `open` (por defecto) = pendientes + atendidos, que es la bandeja de trabajo.
   * `all` = los cuatro estados, para revisar el turno.
   */
  status: z
    .enum(["open", "all", "pending", "acknowledged", "resolved", "cancelled"])
    .optional(),
  type: z.enum(["call_waiter", "request_bill"]).optional(),
  tableId: z.string().uuid().optional(),
  /** Fecha civil peruana (YYYY-MM-DD). */
  from: z.string().regex(CIVIL_DATE, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  to: z.string().regex(CIVIL_DATE, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

type ListStatus = z.infer<typeof listQuerySchema>["status"];

// ── Utilidades locales ──────────────────────────────────────────────

/** Traduce los estados del filtro a la lista concreta que espera el servicio. */
function resolveStatuses(
  status: ListStatus,
): serviceRequestService.ServiceRequestStatus[] {
  if (!status || status === "open") return serviceRequestService.OPEN_STATUSES;
  // El servicio interpreta el array vacío como "todos los estados".
  if (status === "all") return [];
  return [status];
}

/**
 * ¿El filtro pedido incluye avisos ya cerrados?
 *
 * Importa para decidir la ventana temporal: la bandeja viva (pendiente +
 * atendido) NO se acota por fecha —un aviso de las 23:55 sigue abierto a las
 * 00:05 y filtrarlo "por hoy" lo borraría de la campana justo en el caso que
 * esta tabla existe para evitar— mientras que el histórico sí, porque crece sin
 * techo.
 */
function includesClosedStatuses(status: ListStatus): boolean {
  return status === "all" || status === "resolved" || status === "cancelled";
}

/**
 * Difunde la transición. Va al canal de la sede (campana del personal) y, si el
 * aviso está ligado a una sesión, también al canal de esa sesión para que el
 * comensal vea "el mozo va en camino" sin refrescar.
 *
 * Nunca lanza: el cambio de estado ya está confirmado en la base de datos, así
 * que una caída de Redis no puede convertir un "voy" correcto en un 500 que
 * empuje al mozo a reintentar (y a comerse un 409).
 */
async function publishTransition(
  branchId: string,
  eventType: "service_request:acknowledged" | "service_request:resolved",
  request: serviceRequestService.ServiceRequestDetail,
) {
  const event = {
    type: eventType,
    payload: {
      id: request.id,
      type: request.type,
      status: request.status,
      tableId: request.table_id,
      tableNumber: request.table_number,
      tableSessionId: request.table_session_id,
      acknowledgedBy: request.acknowledged_by,
      acknowledgedAt: request.acknowledged_at,
      resolvedAt: request.resolved_at,
    },
    timestamp: Date.now(),
  };

  try {
    await realtime.publish(`branch:${branchId}`, event);
    if (request.table_session_id) {
      await realtime.publish(`session:${request.table_session_id}`, event);
    }
  } catch (err) {
    logger.error("No se pudo publicar la transición del aviso de mesa", {
      serviceRequestId: request.id,
      eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Mapea los errores del servicio a respuestas HTTP. Devuelve `null` si el error
 * no es uno de los esperados, para que el llamador lo propague al manejador
 * global en vez de tragárselo.
 */
function errorResponse(c: Context<AppEnv>, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);

  if (message === serviceRequestService.SERVICE_REQUEST_NOT_FOUND) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Aviso no encontrado" } },
      404,
    );
  }
  if (message === serviceRequestService.SERVICE_REQUEST_ALREADY_HANDLED) {
    return c.json(
      {
        success: false,
        error: {
          code: "CONFLICT",
          message: "Otro compañero ya atendió este aviso",
        },
      },
      409,
    );
  }
  return null;
}

// ── GET / - Bandeja de avisos ───────────────────────────────────────

serviceRequests.get(
  "/",
  requirePermission("tables:read"),
  zValidator("query", listQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const tenant = c.get("tenant");

    // Ventana temporal. Las fechas que escribe el usuario son CIVILES peruanas:
    // "2026-08-07" significa el día 7 en Lima, no el día 7 en UTC (que en Lima
    // empieza a las 19:00 del día 6).
    //
    // - Si pide un rango, se respeta tal cual.
    // - Si solo da un extremo, el otro se completa con el mismo día para que
    //   `?to=` a secas no produzca un rango invertido y vacío.
    // - Si no da ninguno y pide la bandeja viva, NO se acota por fecha.
    // - Si no da ninguno y pide histórico, se acota al día operativo de hoy.
    let from: Date | undefined;
    let to: Date | undefined;

    if (query.from || query.to) {
      from = peruCivilDayStart(query.from ?? query.to!);
      to = peruCivilDayEnd(query.to ?? query.from!);
    } else if (includesClosedStatuses(query.status)) {
      // `peruStartOfDay`/`peruEndOfDay` reciben un INSTANTE y devuelven el día
      // operativo de Lima que lo contiene: a las 20:00 de Lima el día UTC ya ha
      // cambiado y usar el reloj UTC dejaría la bandeja vacía.
      from = peruStartOfDay();
      to = peruEndOfDay();
    }

    if (from && to && from >= to) {
      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "El rango de fechas es inválido: 'from' debe ser anterior a 'to'",
          },
        },
        400,
      );
    }

    const requests = await serviceRequestService.listServiceRequests({
      organizationId: tenant.organizationId,
      branchId: tenant.branchId,
      status: resolveStatuses(query.status),
      type: query.type,
      tableId: query.tableId,
      from,
      to,
      limit: query.limit,
    });

    return c.json({ success: true, data: requests });
  },
);

// ── POST /:id/ack - "Voy" ───────────────────────────────────────────

serviceRequests.post(
  "/:id/ack",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant");
    const user = c.get("user");

    // `sub` es el id del usuario en el token de personal, pero el id de SESIÓN
    // en el del comensal: sellar `acknowledged_by` con este último apuntaría a
    // una fila inexistente en `users`. `requirePermission` ya rechaza al rol
    // `customer`, pero el sello de autoría no puede depender de eso.
    if (user.role === "customer") {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Sin permisos" } },
        403,
      );
    }

    try {
      const request = await serviceRequestService.acknowledgeServiceRequest(
        id,
        user.sub,
        { organizationId: tenant.organizationId, branchId: tenant.branchId },
      );

      await publishTransition(
        tenant.branchId,
        "service_request:acknowledged",
        request,
      );

      return c.json({ success: true, data: request });
    } catch (e) {
      const mapped = errorResponse(c, e);
      if (mapped) return mapped;
      throw e;
    }
  },
);

// ── POST /:id/resolve - Aviso atendido ──────────────────────────────

serviceRequests.post(
  "/:id/resolve",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant");

    try {
      const request = await serviceRequestService.resolveServiceRequest(id, {
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
      });

      await publishTransition(tenant.branchId, "service_request:resolved", request);

      return c.json({ success: true, data: request });
    } catch (e) {
      const mapped = errorResponse(c, e);
      if (mapped) return mapped;
      throw e;
    }
  },
);

export { serviceRequests };
export default serviceRequests;
