import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { auditFromContext } from "../lib/audit.js";
import * as cashService from "../services/cash.service.js";
import { CashSessionError } from "../services/cash.service.js";

/**
 * Arqueo de caja (/api/cash).
 *
 * Abrir caja, cobrar, cerrar caja y cuadrar el efectivo. La ruta solo hace
 * HTTP: validación de entrada, permisos, traducción de errores y auditoría.
 * Toda la lógica vive en `cash.service.ts`.
 *
 * Permisos: leer con `cash:read` (cajero, encargado, admin); abrir y cerrar con
 * `cash:manage`.
 */
const cash = new Hono<AppEnv>();

cash.use("*", authMiddleware);
cash.use("*", tenantMiddleware);
cash.use("*", requireBranch);

// ── Esquemas de entrada (inline a propósito: no se toca @restai/validators) ──

/** Tope defensivo: 1 000 000,00 soles en céntimos. Un arqueo mayor es un tecleo. */
const MAX_CENTS = 100_000_000;

const openSchema = z.object({
  /** Fondo inicial en CÉNTIMOS. */
  openingFloat: z.number().int().min(0).max(MAX_CENTS).default(0),
  openingNotes: z.string().trim().max(1000).optional(),
});

const closeSchema = z.object({
  /** Efectivo contado físicamente en el cajón, en CÉNTIMOS. */
  countedCash: z.number().int().min(0).max(MAX_CENTS),
  closingNotes: z.string().trim().max(1000).optional(),
});

const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)");

const listQuerySchema = z.object({
  /** Fecha civil peruana (día operativo), inclusive. */
  from: civilDate.optional(),
  /** Fecha civil peruana (día operativo), inclusive. */
  to: civilDate.optional(),
  status: z.enum(["open", "closed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({ id: z.string().uuid() });

// ── Utilidades ──────────────────────────────────────────────────────

/** Formatea céntimos como soles para las frases de auditoría. */
function soles(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}S/ ${(abs / 100).toFixed(2)}`;
}

/**
 * Traduce los errores del servicio a respuesta HTTP. Cualquier otro error se
 * relanza para que lo trate el manejador global.
 */
function toHttpError(err: unknown): { status: 404 | 409; body: unknown } {
  if (err instanceof CashSessionError) {
    return {
      status: err.status,
      body: {
        success: false,
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      },
    };
  }
  throw err;
}

// ── GET /current ────────────────────────────────────────────────────

/**
 * La caja abierta de la sede con sus totales en vivo, o `data: null` si no hay
 * ninguna. `null` NO es un error: es el estado normal antes de abrir el turno.
 */
cash.get("/current", requirePermission("cash:read"), async (c) => {
  const tenant = c.get("tenant");

  const current = await cashService.getCurrentCashSession({
    organizationId: tenant.organizationId,
    branchId: tenant.branchId,
  });

  return c.json({ success: true, data: current });
});

// ── POST /open ──────────────────────────────────────────────────────

cash.post(
  "/open",
  requirePermission("cash:manage"),
  zValidator("json", openSchema),
  async (c) => {
    const tenant = c.get("tenant");
    const user = c.get("user") as any;
    const body = c.req.valid("json");

    let session: Awaited<ReturnType<typeof cashService.openCashSession>>;
    try {
      session = await cashService.openCashSession({
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
        userId: user?.sub ?? null,
        openingFloat: body.openingFloat,
        openingNotes: body.openingNotes ?? null,
      });
    } catch (err) {
      const { status, body: errorBody } = toHttpError(err);
      return c.json(errorBody as any, status);
    }

    await auditFromContext(c, {
      action: "cash.open",
      entityType: "cash_session",
      entityId: session.id,
      summary: `Apertura de caja del ${session.business_date} con fondo ${soles(session.opening_float)}`,
      after: {
        business_date: session.business_date,
        opening_float: session.opening_float,
        opening_notes: session.opening_notes,
      },
    });

    return c.json({ success: true, data: session }, 201);
  },
);

// ── POST /close ─────────────────────────────────────────────────────

cash.post(
  "/close",
  requirePermission("cash:manage"),
  zValidator("json", closeSchema),
  async (c) => {
    const tenant = c.get("tenant");
    const user = c.get("user") as any;
    const body = c.req.valid("json");

    let result: Awaited<ReturnType<typeof cashService.closeCashSession>>;
    try {
      result = await cashService.closeCashSession({
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
        userId: user?.sub ?? null,
        countedCash: body.countedCash,
        closingNotes: body.closingNotes ?? null,
      });
    } catch (err) {
      const { status, body: errorBody } = toHttpError(err);
      return c.json(errorBody as any, status);
    }

    const { before, session } = result;
    const totals = session.totals;
    const diff = session.difference ?? 0;
    const veredicto = diff === 0 ? "cuadra" : diff > 0 ? "sobrante" : "faltante";

    await auditFromContext(c, {
      action: "cash.close",
      entityType: "cash_session",
      entityId: session.id,
      summary:
        `Cierre de caja del ${session.business_date}: esperado ${soles(session.expected_cash ?? 0)}, ` +
        `contado ${soles(session.counted_cash ?? 0)}, diferencia ${soles(diff)} (${veredicto})`,
      before: {
        status: before.status,
        opening_float: before.opening_float,
        opened_at: before.opened_at,
      },
      after: {
        status: session.status,
        expected_cash: session.expected_cash,
        counted_cash: session.counted_cash,
        difference: session.difference,
        cash_sales: totals.cash_sales,
        non_cash_sales: totals.non_cash_sales,
        cash_tips: totals.cash_tips,
        voided_total: totals.voided_total,
        payment_count: totals.payment_count,
        closing_notes: session.closing_notes,
      },
    });

    return c.json({ success: true, data: session });
  },
);

// ── GET / ───────────────────────────────────────────────────────────

/** Historial paginado, filtrable por rango de días operativos (fecha civil). */
cash.get(
  "/",
  requirePermission("cash:read"),
  zValidator("query", listQuerySchema),
  async (c) => {
    const tenant = c.get("tenant");
    const { from, to, status, page, limit } = c.req.valid("query");

    const { data, pagination } = await cashService.listCashSessions({
      organizationId: tenant.organizationId,
      branchId: tenant.branchId,
      from,
      to,
      status,
      page,
      limit,
    });

    return c.json({ success: true, data, pagination });
  },
);

// ── GET /:id ────────────────────────────────────────────────────────

/** Detalle de un arqueo (abierto o cerrado) con su desglose recalculado. */
cash.get(
  "/:id",
  requirePermission("cash:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const tenant = c.get("tenant");
    const { id } = c.req.valid("param");

    try {
      const session = await cashService.getCashSessionById({
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
        id,
      });
      return c.json({ success: true, data: session });
    } catch (err) {
      const { status, body } = toHttpError(err);
      return c.json(body as any, status);
    }
  },
);

// Se exporta con nombre (convención del repo) y por defecto, para que el
// montaje en app.ts funcione con cualquiera de las dos formas.
export { cash };
export default cash;
