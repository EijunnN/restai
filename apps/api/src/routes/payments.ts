import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import {
  eq,
  and,
  desc,
  gte,
  lt,
  sql,
  sum,
  inArray,
  isNull,
  isNotNull,
} from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import { camposDeCambioDeEstado } from "../services/order-status.js";
import { createPaymentSchema, idParamSchema } from "@restai/validators";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import {
  peruStartOfDay,
  peruEndOfDay,
  peruCivilDayStart,
  peruCivilDayEnd,
} from "../lib/timezone.js";
import { auditFromContext } from "../lib/audit.js";
import { handleOrderCompletion } from "../services/order.service.js";
import * as cashService from "../services/cash.service.js";
import { realtime } from "../infrastructure/container.js";
import { logger } from "../lib/logger.js";

const payments = new Hono<AppEnv>();

payments.use("*", authMiddleware);
payments.use("*", tenantMiddleware);
payments.use("*", requireBranch);

// ---------------------------------------------------------------------------
// Ayudantes internos
// ---------------------------------------------------------------------------

/**
 * Estados de orden en los que la comanda sigue VIVA en cocina.
 *
 * Un cobro nunca debe borrar una comanda del tablero de cocina: si el cliente
 * paga por adelantado en el mostrador y el plato todavía se está preparando,
 * marcar la orden como 'completed' la haría desaparecer de la pantalla y el
 * plato jamás saldría. Por eso el cierre de estado solo se aplica cuando la
 * comida ya está lista o servida; los efectos contables (inventario y puntos)
 * sí se disparan siempre al saldar, que es lo que hoy descuadraba el stock.
 */
const KITCHEN_QUEUE_STATUSES = ["pending", "confirmed", "preparing"];

/**
 * Estados desde los que un cobro puede cerrar una venta de mostrador.
 *
 * OJO: `ready → completed` NO está en ORDER_STATUS_TRANSITIONS, que obliga a
 * pasar por 'served'. En una venta de mostrador o de delivery no existe el acto
 * de "servir en mesa": el cliente paga y se lleva el pedido, y ese pago es la
 * entrega. La excepción se aplica aquí a propósito y SOLO a órdenes sin mesa;
 * el resto de la aplicación sigue respetando la máquina de estados.
 */
const CLOSABLE_BY_PAYMENT = ["ready", "served"] as const;

/**
 * Cierra la orden si todavía está en un estado cerrable, y dice si lo hizo.
 *
 * Idempotente por construcción: el UPDATE está guardado por el estado, y el
 * llamador mantiene el `FOR UPDATE` sobre la fila, así que dos cobros
 * simultáneos de la misma orden no pueden cerrarla dos veces.
 */
async function closeCounterOrder(txOrDb: DbOrTx, orderId: string): Promise<boolean> {
  const closed = await txOrDb
    .update(schema.orders)
    .set(camposDeCambioDeEstado("completed"))
    .where(
      and(
        eq(schema.orders.id, orderId),
        inArray(schema.orders.status, [...CLOSABLE_BY_PAYMENT]),
      ),
    )
    .returning({ id: schema.orders.id });

  return closed.length > 0;
}

/**
 * Devuelve la caja abierta de la sede, o null si no hay ninguna.
 *
 * Deliberadamente NO bloquea el cobro cuando no hay caja: un local que aún no
 * abrió turno tiene que poder cobrar igual. El pago queda sin `cash_session_id`
 * y el arqueo lo verá como "cobrado fuera de caja", que es información útil, no
 * un error fatal.
 *
 * Cuando SÍ hay caja abierta, se toma un `FOR SHARE` sobre su fila.
 *
 * Esto no es decorativo: `closeCashSession` bloquea la misma fila con
 * `FOR UPDATE` para calcular el efectivo esperado. Sin el bloqueo compartido de
 * este lado, un cobro en vuelo podía confirmarse DESPUÉS de que el cierre
 * hubiera calculado el esperado y quedaba atribuido a una caja ya cerrada: el
 * arqueo salía descuadrado exactamente por ese importe y sin ninguna traza que
 * lo explicara. `FOR SHARE` permite que varios cobros simultáneos convivan
 * (comparten el candado) pero obliga al cierre a esperar a que todos terminen.
 */
async function findOpenCashSessionId(
  txOrDb: DbOrTx,
  organizationId: string,
  branchId: string,
): Promise<string | null> {
  const session = await cashService.findOpenCashSession(
    { organizationId, branchId, lock: "share" },
    txOrDb,
  );
  return session?.id ?? null;
}

/**
 * Sello temporal ÚNICO del cobro dentro de su orden.
 *
 * No existe tabla puente cobro↔ítem (la migración 0012 no la añadió), así que el
 * vínculo de la cuenta dividida es la igualdad `order_items.paid_at =
 * payments.created_at`. Para que esa igualdad identifique a UN solo cobro hace
 * falta que dos cobros de la misma orden NUNCA compartan `created_at`, y el
 * `DEFAULT now()` de Postgres no lo garantiza: `now()` devuelve el instante de
 * INICIO de la transacción, no el del INSERT. Dos cobros disparados en el mismo
 * milisegundo (un doble clic, un reintento del cliente) arrancan su transacción
 * a la vez y obtienen el MISMO valor aunque el bloqueo de la orden los serialice
 * después. Si eso ocurriera, anular uno liberaría también los ítems del otro y
 * el comensal acabaría pagando dos veces por el mismo plato.
 *
 * Por eso el sello se calcula aquí, siempre DENTRO del bloqueo `FOR UPDATE` de
 * la orden: se toma el mayor instante ya usado por esa orden (cobros previos e
 * ítems ya sellados, ambos ya confirmados porque el bloqueo serializa) y se
 * devuelve uno estrictamente mayor. Se aplica también a los cobros de orden
 * completa, para que su `created_at` tampoco pueda coincidir por casualidad con
 * el sello de unos ítems que no cobró.
 *
 * Se leen las columnas por Drizzle (no con `MAX()` crudo) para que la ida y la
 * vuelta usen exactamente la misma representación de milisegundos y la
 * comparación de la anulación sea exacta.
 */
async function nextPaymentStamp(txOrDb: DbOrTx, orderId: string): Promise<Date> {
  const [lastPayment] = await txOrDb
    .select({ created_at: schema.payments.created_at })
    .from(schema.payments)
    .where(eq(schema.payments.order_id, orderId))
    .orderBy(desc(schema.payments.created_at))
    .limit(1);

  const [lastItem] = await txOrDb
    .select({ paid_at: schema.orderItems.paid_at })
    .from(schema.orderItems)
    .where(
      and(
        eq(schema.orderItems.order_id, orderId),
        isNotNull(schema.orderItems.paid_at),
      ),
    )
    .orderBy(desc(schema.orderItems.paid_at))
    .limit(1);

  const floor = Math.max(
    lastPayment?.created_at?.getTime() ?? 0,
    lastItem?.paid_at?.getTime() ?? 0,
  );

  return new Date(Math.max(Date.now(), floor + 1));
}

/**
 * Condición canónica de "cobro real": completado y no anulado.
 *
 * Se usa en TODAS las sumas de dinero (saldo de la orden, resumen del día,
 * órdenes pendientes de pago). Un pago anulado pasa a status 'refunded', pero
 * se filtra además por `voided_at IS NULL` como defensa en profundidad: la BD
 * no obliga a que ambas cosas vayan juntas.
 */
function collectedPaymentConditions() {
  return [eq(schema.payments.status, "completed"), isNull(schema.payments.voided_at)];
}

/** Mismo criterio que `collectedPaymentConditions`, en SQL crudo para subconsultas. */
const COLLECTED_SQL = sql`payments.status = 'completed' AND payments.voided_at IS NULL`;

/**
 * Efectos de cierre de una orden de mostrador/delivery que acaba de quedar
 * saldada. Se ejecuta FUERA de la transacción del cobro a propósito:
 * `handleOrderCompletion` abre sus propias transacciones y toma un `FOR UPDATE`
 * sobre la misma fila de `orders` que el cobro tiene bloqueada, así que
 * llamarlo dentro provocaría un interbloqueo garantizado.
 *
 * La atomicidad real vive en el propio `handleOrderCompletion`: es idempotente
 * (los puntos no se otorgan dos veces y el descuento de stock está guardado por
 * `inventory_deducted` bajo bloqueo de fila), de modo que si la cocina cierra
 * después la orden por su camino habitual, no se duplica nada.
 */
async function finalizeCounterOrder(params: {
  order: typeof schema.orders.$inferSelect;
  /** true si el cobro además transicionó la orden a 'completed'. */
  statusClosed: boolean;
  organizationId: string;
  branchId: string;
}): Promise<void> {
  const { order, statusClosed, organizationId, branchId } = params;

  try {
    await handleOrderCompletion({
      orderId: order.id,
      orderNumber: order.order_number,
      orderSubtotal: order.subtotal,
      orderDiscount: order.discount,
      customerId: order.customer_id,
      organizationId,
      branchId,
    });
  } catch (err) {
    // Nunca puede tumbar un cobro ya confirmado al cliente.
    logger.error("Error al cerrar el ciclo de la orden tras el cobro", {
      orderId: order.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (statusClosed) {
    const payload = {
      type: "order:updated",
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        status: "completed",
      },
      timestamp: Date.now(),
    };
    await realtime.publish(`branch:${branchId}`, payload);
    await realtime.publish(`branch:${branchId}:kitchen`, payload);
  }
}

// ---------------------------------------------------------------------------
// GET /summary - Resumen de caja del día (debe ir antes de /:id)
// ---------------------------------------------------------------------------

payments.get("/summary", requirePermission("payments:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const startOfDay = peruStartOfDay();
  const endOfDay = peruEndOfDay(); // exclusivo: medianoche del día siguiente

  const scope = [
    eq(schema.payments.branch_id, tenant.branchId),
    eq(schema.payments.organization_id, tenant.organizationId),
    gte(schema.payments.created_at, startOfDay),
    lt(schema.payments.created_at, endOfDay),
  ];

  // Solo lo COBRADO de verdad entra en el total del día.
  const collected = and(...scope, ...collectedPaymentConditions());
  // Anulado: se muestra aparte para que el cierre de caja cuadre y se vea el
  // volumen de errores/devoluciones del turno.
  const voided = and(...scope, isNotNull(schema.payments.voided_at));
  // Pendiente: típicamente delivery contra reembolso. NO es dinero en caja.
  const pending = and(
    ...scope,
    eq(schema.payments.status, "pending"),
    isNull(schema.payments.voided_at),
  );

  const [byMethod, totals, voidedTotals, pendingTotals] = await Promise.all([
    db
      .select({
        method: schema.payments.method,
        total: sum(schema.payments.amount),
        tip: sum(schema.payments.tip),
        count: sql<number>`count(*)::int`,
      })
      .from(schema.payments)
      .where(collected)
      .groupBy(schema.payments.method),
    db
      .select({
        grand_total: sum(schema.payments.amount),
        tip_total: sum(schema.payments.tip),
        count: sql<number>`count(*)::int`,
      })
      .from(schema.payments)
      .where(collected),
    db
      .select({
        total: sum(schema.payments.amount),
        count: sql<number>`count(*)::int`,
      })
      .from(schema.payments)
      .where(voided),
    db
      .select({
        total: sum(schema.payments.amount),
        count: sql<number>`count(*)::int`,
      })
      .from(schema.payments)
      .where(pending),
  ]);

  const cashCollected =
    byMethod.find((m) => m.method === "cash")?.total ?? 0;

  return c.json({
    success: true,
    data: {
      byMethod: byMethod.map((m) => ({
        method: m.method,
        total: Number(m.total || 0),
        tip: Number(m.tip || 0),
        count: m.count,
      })),
      grandTotal: Number(totals[0]?.grand_total || 0),
      tipTotal: Number(totals[0]?.tip_total || 0),
      totalCount: totals[0]?.count || 0,
      /** Efectivo cobrado (base del arqueo, sin contar el fondo inicial). */
      cashTotal: Number(cashCollected || 0),
      voided: {
        total: Number(voidedTotals[0]?.total || 0),
        count: voidedTotals[0]?.count || 0,
      },
      pending: {
        total: Number(pendingTotals[0]?.total || 0),
        count: pendingTotals[0]?.count || 0,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /unpaid-orders - Órdenes con saldo pendiente (selector del diálogo de cobro)
// ---------------------------------------------------------------------------

payments.get("/unpaid-orders", requirePermission("payments:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  // El filtro de "impagas" (total_paid < orders.total) se hace en SQL ANTES del
  // límite, para no perder órdenes impagas al truncar el conjunto candidato.
  // Los pagos ANULADOS no cuentan como cobro: al anular un cobro la orden
  // vuelve a aparecer aquí con su saldo, que es justo lo que necesita el cajero.
  const result = await db
    .select({
      id: schema.orders.id,
      order_number: schema.orders.order_number,
      customer_name: schema.orders.customer_name,
      total: schema.orders.total,
      status: schema.orders.status,
      created_at: schema.orders.created_at,
      total_paid: sql<number>`COALESCE((SELECT SUM(amount)::bigint FROM payments WHERE payments.order_id = ${schema.orders.id} AND ${COLLECTED_SQL}), 0)::int`,
      table_number: schema.tables.number,
    })
    .from(schema.orders)
    .leftJoin(schema.tableSessions, eq(schema.orders.table_session_id, schema.tableSessions.id))
    .leftJoin(schema.tables, eq(schema.tableSessions.table_id, schema.tables.id))
    .where(
      and(
        eq(schema.orders.branch_id, tenant.branchId),
        eq(schema.orders.organization_id, tenant.organizationId),
        sql`${schema.orders.status} != 'cancelled'`,
        sql`COALESCE((SELECT SUM(amount)::bigint FROM payments WHERE payments.order_id = ${schema.orders.id} AND ${COLLECTED_SQL}), 0) < ${schema.orders.total}`,
      ),
    )
    .orderBy(desc(schema.orders.created_at))
    .limit(50);

  const unpaid = result.map((o) => ({
    ...o,
    remaining: o.total - o.total_paid,
  }));

  return c.json({ success: true, data: unpaid });
});

// ---------------------------------------------------------------------------
// GET / - Listado de cobros de la sede
// ---------------------------------------------------------------------------

const listPaymentsQuerySchema = z.object({
  method: z.enum(["cash", "card", "yape", "plin", "transfer", "other"]).optional(),
  /** Cubo lógico, no el enum de BD: qué representa la fila para la caja. */
  bucket: z.enum(["all", "collected", "voided", "pending"]).default("all"),
  /**
   * Fecha civil peruana "YYYY-MM-DD" tal como la escribe el usuario. El formato
   * se valida aquí: sin la comprobación, un `?startDate=ayer` llegaba como
   * `Invalid Date` al driver y el listado respondía 500 en vez de 400.
   */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)")
    .optional(),
});

payments.get(
  "/",
  requirePermission("payments:read"),
  zValidator("query", listPaymentsQuerySchema),
  async (c) => {
    const tenant = c.get("tenant") as any;
    const { method, bucket, startDate, endDate } = c.req.valid("query");

    const conditions: any[] = [
      eq(schema.payments.branch_id, tenant.branchId),
      eq(schema.payments.organization_id, tenant.organizationId),
    ];

    if (method) {
      conditions.push(eq(schema.payments.method, method));
    }
    // Las fechas las escribe el usuario en un DatePicker: se interpretan como
    // días civiles de Lima, no como instantes UTC (si no, el turno de noche
    // caía en el día siguiente y el cierre de caja no cuadraba).
    if (startDate) {
      conditions.push(gte(schema.payments.created_at, peruCivilDayStart(startDate)));
    }
    if (endDate) {
      conditions.push(lt(schema.payments.created_at, peruCivilDayEnd(endDate)));
    }

    // El cubo filtra la LISTA; los totales de abajo se calculan siempre sobre
    // el mismo rango, separando cobrado / anulado / pendiente.
    const listConditions = [...conditions];
    if (bucket === "collected") {
      listConditions.push(...collectedPaymentConditions());
    } else if (bucket === "voided") {
      listConditions.push(isNotNull(schema.payments.voided_at));
    } else if (bucket === "pending") {
      listConditions.push(
        eq(schema.payments.status, "pending"),
        isNull(schema.payments.voided_at),
      );
    }

    const [result, totals] = await Promise.all([
      db
        .select({
          id: schema.payments.id,
          order_id: schema.payments.order_id,
          organization_id: schema.payments.organization_id,
          branch_id: schema.payments.branch_id,
          method: schema.payments.method,
          amount: schema.payments.amount,
          reference: schema.payments.reference,
          tip: schema.payments.tip,
          status: schema.payments.status,
          user_id: schema.payments.user_id,
          cash_session_id: schema.payments.cash_session_id,
          voided_at: schema.payments.voided_at,
          voided_by: schema.payments.voided_by,
          void_reason: schema.payments.void_reason,
          created_at: schema.payments.created_at,
          order_number: schema.orders.order_number,
          cashier_name: schema.users.name,
        })
        .from(schema.payments)
        .leftJoin(schema.orders, eq(schema.payments.order_id, schema.orders.id))
        .leftJoin(schema.users, eq(schema.payments.user_id, schema.users.id))
        .where(and(...listConditions))
        .orderBy(desc(schema.payments.created_at))
        .limit(100),
      db
        // Las sumas se quedan en `bigint` (el driver las devuelve como cadena y
        // se convierten en JS): un rango largo de una sede con volumen puede
        // superar los 2 147 483 647 céntimos y el cast a `int` reventaría la
        // consulta entera con un error de desbordamiento.
        .select({
          collected: sql<string>`COALESCE(SUM(CASE WHEN ${schema.payments.status} = 'completed' AND ${schema.payments.voided_at} IS NULL THEN ${schema.payments.amount} ELSE 0 END), 0)::bigint`,
          collected_count: sql<number>`(COUNT(*) FILTER (WHERE ${schema.payments.status} = 'completed' AND ${schema.payments.voided_at} IS NULL))::int`,
          voided: sql<string>`COALESCE(SUM(CASE WHEN ${schema.payments.voided_at} IS NOT NULL THEN ${schema.payments.amount} ELSE 0 END), 0)::bigint`,
          voided_count: sql<number>`(COUNT(*) FILTER (WHERE ${schema.payments.voided_at} IS NOT NULL))::int`,
          pending: sql<string>`COALESCE(SUM(CASE WHEN ${schema.payments.status} = 'pending' AND ${schema.payments.voided_at} IS NULL THEN ${schema.payments.amount} ELSE 0 END), 0)::bigint`,
          pending_count: sql<number>`(COUNT(*) FILTER (WHERE ${schema.payments.status} = 'pending' AND ${schema.payments.voided_at} IS NULL))::int`,
        })
        .from(schema.payments)
        .where(and(...conditions)),
    ]);

    return c.json({
      success: true,
      data: result.map((p) => ({ ...p, voided: p.voided_at !== null })),
      meta: {
        totals: {
          collected: Number(totals[0]?.collected ?? 0),
          collectedCount: totals[0]?.collected_count ?? 0,
          voided: Number(totals[0]?.voided ?? 0),
          voidedCount: totals[0]?.voided_count ?? 0,
          pending: Number(totals[0]?.pending ?? 0),
          pendingCount: totals[0]?.pending_count ?? 0,
        },
      },
    });
  },
);

// ---------------------------------------------------------------------------
// POST / - Registrar un cobro (admite pagos parciales)
// ---------------------------------------------------------------------------

payments.post(
  "/",
  requirePermission("payments:create"),
  zValidator("json", createPaymentSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;
    const userId: string | null = user?.sub ?? null;

    // Serializa cobros concurrentes de la misma orden: bloquea la fila de la
    // orden, vuelve a sumar los cobros previos DENTRO de la transacción y solo
    // entonces limita/rechaza e inserta.
    const txResult = await db.transaction(async (tx) => {
      // La orden debe pertenecer al tenant + se bloquea FOR UPDATE
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.id, body.orderId),
            eq(schema.orders.organization_id, tenant.organizationId),
            eq(schema.orders.branch_id, tenant.branchId),
          ),
        )
        .limit(1)
        .for("update");

      if (!order) {
        return { error: { status: 404 as const, code: "NOT_FOUND", message: "Orden no encontrada" } };
      }
      if (order.status === "cancelled") {
        return { error: { status: 400 as const, code: "BAD_REQUEST", message: "La orden está cancelada" } };
      }

      // Se vuelven a sumar los cobros previos (completados y NO anulados)
      const [prevPayments] = await tx
        .select({
          total_paid: sum(schema.payments.amount),
        })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, body.orderId),
            ...collectedPaymentConditions(),
          ),
        );

      const previouslyPaid = Number(prevPayments?.total_paid || 0);

      const remaining = order.total - previouslyPaid;
      if (remaining <= 0) {
        return { error: { status: 400 as const, code: "BAD_REQUEST", message: "La orden ya está pagada" } };
      }

      // El cobro nunca puede exceder el saldo
      const effectiveAmount = Math.min(body.amount, remaining);

      // Autoría: quién cobró y en qué caja. Sin esto el arqueo no puede
      // atribuir un faltante a nadie.
      const cashSessionId = await findOpenCashSessionId(
        tx,
        tenant.organizationId,
        tenant.branchId,
      );

      // Sello único dentro de la orden: aquí no marca ítems, pero evita que este
      // cobro comparta instante con el sello de un cobro por ítems (lo que haría
      // que anularlo liberase ítems que no cubría). Ver `nextPaymentStamp`.
      const createdAt = await nextPaymentStamp(tx, body.orderId);

      const [payment] = await tx
        .insert(schema.payments)
        .values({
          order_id: body.orderId,
          organization_id: tenant.organizationId,
          branch_id: tenant.branchId,
          method: body.method,
          amount: effectiveAmount,
          reference: body.reference,
          tip: body.tip,
          status: "completed",
          user_id: userId,
          cash_session_id: cashSessionId,
          created_at: createdAt,
        })
        .returning();

      const totalPaid = previouslyPaid + effectiveAmount;
      const fullyPaid = totalPaid >= order.total;

      // Cierre de ciclo para ventas SIN mesa (mostrador y delivery): la mesa se
      // cierra al liberarla, pero estas órdenes no tenían ningún evento de
      // cierre, así que el stock nunca se descontaba. Ver KITCHEN_QUEUE_STATUSES.
      const isCounterSale = !order.table_session_id;
      const shouldFinalize = isCounterSale && fullyPaid && order.status !== "completed";
      let statusClosed = false;

      if (shouldFinalize && !KITCHEN_QUEUE_STATUSES.includes(order.status)) {
        statusClosed = await closeCounterOrder(tx, order.id);
      }

      return { error: null, order, payment, totalPaid, fullyPaid, shouldFinalize, statusClosed };
    });

    if (txResult.error) {
      const { status, code, message } = txResult.error;
      return c.json({ success: false, error: { code, message } }, status);
    }

    const { order, payment, totalPaid, fullyPaid, shouldFinalize, statusClosed } = txResult;

    if (shouldFinalize) {
      await finalizeCounterOrder({
        order,
        statusClosed,
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
      });
    }

    return c.json({
      success: true,
      data: {
        ...payment,
        order_number: order.order_number,
        order_total: order.total,
        total_paid: totalPaid,
        remaining: Math.max(0, order.total - totalPaid),
        fully_paid: fullyPaid,
        order_completed: statusClosed,
      },
    }, 201);
  },
);

// ---------------------------------------------------------------------------
// POST /items - Cobro por ítems (cuenta dividida)
// ---------------------------------------------------------------------------
// Registra un cobro por la parte proporcional de los ítems seleccionados y los
// marca como pagados, para poder liquidar una mesa compartida producto a
// producto. El "monto recibido"/vuelto en efectivo es cosa del cliente; lo que
// se registra es lo adeudado. La orden de mesa se finaliza al liberar la mesa.
const payItemsSchema = z.object({
  orderId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1),
  method: z.enum(["cash", "card", "yape", "plin", "transfer", "other"]),
  reference: z.string().max(255).optional(),
  tip: z.number().int().min(0).default(0),
});

payments.post(
  "/items",
  requirePermission("payments:create"),
  zValidator("json", payItemsSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;
    const userId: string | null = user?.sub ?? null;

    const txResult = await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.id, body.orderId),
            eq(schema.orders.organization_id, tenant.organizationId),
            eq(schema.orders.branch_id, tenant.branchId),
          ),
        )
        .limit(1)
        .for("update");

      if (!order) {
        return { error: { status: 404 as const, code: "NOT_FOUND", message: "Orden no encontrada" } };
      }
      if (order.status === "cancelled") {
        return { error: { status: 400 as const, code: "BAD_REQUEST", message: "La orden está cancelada" } };
      }

      const allItems = await tx
        .select({
          id: schema.orderItems.id,
          total: schema.orderItems.total,
          status: schema.orderItems.status,
          paid_at: schema.orderItems.paid_at,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.order_id, body.orderId));

      const byId = new Map(allItems.map((i) => [i.id, i]));
      for (const id of body.itemIds) {
        const it = byId.get(id);
        if (!it) {
          return { error: { status: 400 as const, code: "BAD_REQUEST", message: "Ítem inválido para esta orden" } };
        }
        // Una línea anulada ("86": se acabó el plato) ya salió del importe de la
        // orden cuando cocina la anuló, así que cobrarla sería cobrar dos veces
        // la diferencia. El diálogo de cobro sigue mostrándola, de modo que hay
        // que rechazarla aquí con un mensaje que el cajero entienda.
        if (it.status === "cancelled") {
          return {
            error: {
              status: 400 as const,
              code: "BAD_REQUEST",
              message: "Uno de los productos fue anulado y no se puede cobrar",
            },
          };
        }
        if (it.paid_at) {
          return { error: { status: 409 as const, code: "CONFLICT", message: "Uno de los ítems ya fue pagado" } };
        }
      }

      const selectedSet = new Set(body.itemIds);
      // Las líneas anuladas no cuentan como "pendientes de cobro": si contaran,
      // seleccionar todo lo que queda vivo nunca se reconocería como liquidación
      // total y el saldo quedaría con un residuo de redondeo que impedía cerrar
      // la cuenta.
      const unpaidItems = allItems.filter(
        (i) => !i.paid_at && i.status !== "cancelled",
      );
      const settlingAll =
        unpaidItems.length === body.itemIds.length &&
        unpaidItems.every((i) => selectedSet.has(i.id));

      const [prev] = await tx
        .select({ total_paid: sum(schema.payments.amount) })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, body.orderId),
            ...collectedPaymentConditions(),
          ),
        );
      const previouslyPaid = Number(prev?.total_paid || 0);
      const remainingBefore = Math.max(0, order.total - previouslyPaid);

      // Saldo exacto cuando se liquida todo lo que queda (sin residuo de
      // redondeo); si no, la parte proporcional de los ítems seleccionados.
      let owed: number;
      if (settlingAll) {
        owed = remainingBefore;
      } else {
        owed = body.itemIds.reduce((acc, id) => {
          const it = byId.get(id)!;
          const share = order.subtotal > 0 ? Math.round((it.total * order.total) / order.subtotal) : 0;
          return acc + share;
        }, 0);
        owed = Math.min(owed, remainingBefore);
      }

      if (owed <= 0) {
        return { error: { status: 400 as const, code: "BAD_REQUEST", message: "Nada por cobrar en la selección" } };
      }

      const cashSessionId = await findOpenCashSessionId(
        tx,
        tenant.organizationId,
        tenant.branchId,
      );

      // Sello único ítem↔cobro, calculado bajo el bloqueo de la orden. Se graba
      // como `created_at` del cobro y como `paid_at` de sus ítems: esa igualdad
      // es la que la anulación usará para saber qué liberar. Ver
      // `nextPaymentStamp` para por qué no vale el `DEFAULT now()`.
      const createdAt = await nextPaymentStamp(tx, body.orderId);

      const [payment] = await tx
        .insert(schema.payments)
        .values({
          order_id: body.orderId,
          organization_id: tenant.organizationId,
          branch_id: tenant.branchId,
          method: body.method,
          amount: owed,
          reference: body.reference,
          tip: body.tip,
          status: "completed",
          user_id: userId,
          cash_session_id: cashSessionId,
          created_at: createdAt,
        })
        .returning();

      // Se sellan los ítems con EXACTAMENTE el `created_at` del cobro recién
      // insertado (se toma del objeto devuelto por el INSERT para que ida y
      // vuelta compartan representación). El guard `paid_at IS NULL` protege
      // frente a carreras: si otra pantalla ya cobró la línea, no se pisa.
      await tx
        .update(schema.orderItems)
        .set({ paid_at: payment.created_at })
        .where(
          and(
            inArray(schema.orderItems.id, body.itemIds),
            eq(schema.orderItems.order_id, body.orderId),
            isNull(schema.orderItems.paid_at),
          ),
        );

      const totalPaid = previouslyPaid + owed;
      const fullyPaid = totalPaid >= order.total;

      // Mismo cierre de ciclo que en POST /: solo aplica a ventas sin mesa.
      const isCounterSale = !order.table_session_id;
      const shouldFinalize = isCounterSale && fullyPaid && order.status !== "completed";
      let statusClosed = false;

      if (shouldFinalize && !KITCHEN_QUEUE_STATUSES.includes(order.status)) {
        statusClosed = await closeCounterOrder(tx, order.id);
      }

      return {
        error: null,
        order,
        payment,
        owed,
        totalPaid,
        fullyPaid,
        shouldFinalize,
        statusClosed,
      };
    });

    if (txResult.error) {
      const { status, code, message } = txResult.error;
      return c.json({ success: false, error: { code, message } }, status);
    }

    const { order, payment, owed, totalPaid, fullyPaid, shouldFinalize, statusClosed } = txResult;

    if (shouldFinalize) {
      await finalizeCounterOrder({
        order,
        statusClosed,
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
      });
    }

    return c.json(
      {
        success: true,
        data: {
          ...payment,
          order_number: order.order_number,
          order_total: order.total,
          charged: owed,
          total_paid: totalPaid,
          remaining: Math.max(0, order.total - totalPaid),
          fully_paid: fullyPaid,
          order_completed: statusClosed,
        },
      },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// POST /:id/void - Anular un cobro
// ---------------------------------------------------------------------------
// Un cobro mal tecleado (importe equivocado, método equivocado, orden
// equivocada) no se borra jamás: se anula dejando quién, cuándo y por qué.
// El importe deja de contar como dinero cobrado, los ítems que cubría vuelven a
// quedar pendientes y la orden recupera su saldo.

const voidPaymentSchema = z.object({
  /** Motivo obligatorio: sin él la traza no sirve para nada en una auditoría. */
  reason: z.string().trim().min(5).max(500),
});

payments.post(
  "/:id/void",
  requirePermission("payments:void"),
  zValidator("param", idParamSchema),
  zValidator("json", voidPaymentSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;
    const userId: string | null = user?.sub ?? null;

    const txResult = await db.transaction(async (tx) => {
      // Lectura previa sin bloqueo solo para averiguar la orden. El orden de
      // bloqueo es SIEMPRE orden → pago (igual que en los cobros), para que un
      // cobro y una anulación simultáneos no se interbloqueen.
      const [head] = await tx
        .select({ order_id: schema.payments.order_id })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.id, id),
            eq(schema.payments.organization_id, tenant.organizationId),
            eq(schema.payments.branch_id, tenant.branchId),
          ),
        )
        .limit(1);

      if (!head) {
        return { error: { status: 404 as const, code: "NOT_FOUND", message: "Pago no encontrado" } };
      }

      // El ámbito de tenant se repite aquí aunque el pago ya venga filtrado:
      // si un dato inconsistente apuntase a una orden de otra sede, el bloqueo y
      // el recálculo se harían sobre dinero ajeno.
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.id, head.order_id),
            eq(schema.orders.organization_id, tenant.organizationId),
            eq(schema.orders.branch_id, tenant.branchId),
          ),
        )
        .limit(1)
        .for("update");

      if (!order) {
        return { error: { status: 404 as const, code: "NOT_FOUND", message: "Orden no encontrada" } };
      }

      const [payment] = await tx
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.id, id),
            eq(schema.payments.organization_id, tenant.organizationId),
            eq(schema.payments.branch_id, tenant.branchId),
          ),
        )
        .limit(1)
        .for("update");

      if (!payment) {
        return { error: { status: 404 as const, code: "NOT_FOUND", message: "Pago no encontrado" } };
      }
      if (payment.voided_at) {
        return { error: { status: 409 as const, code: "CONFLICT", message: "El pago ya fue anulado" } };
      }
      if (payment.status !== "completed") {
        return {
          error: {
            status: 400 as const,
            code: "BAD_REQUEST",
            message: "Solo se pueden anular cobros completados",
          },
        };
      }

      const voidedAt = new Date();

      // `voided_at` y `void_reason` van siempre juntos (CHECK de la migración
      // 0012). status 'refunded' saca el importe de todos los totales.
      const [voided] = await tx
        .update(schema.payments)
        .set({
          voided_at: voidedAt,
          voided_by: userId,
          void_reason: reason,
          status: "refunded",
        })
        .where(and(eq(schema.payments.id, id), isNull(schema.payments.voided_at)))
        .returning();

      if (!voided) {
        return { error: { status: 409 as const, code: "CONFLICT", message: "El pago ya fue anulado" } };
      }

      // Liberar los ítems que cubría este cobro (cuenta dividida). El vínculo es
      // la igualdad exacta `order_items.paid_at = payments.created_at`, sellada
      // al cobrar por ítems y garantizada única dentro de la orden por
      // `nextPaymentStamp`: ningún otro cobro de esta orden puede compartir ese
      // instante, así que aquí no se libera nada que cubriera otro cobro. Los
      // cobros de orden completa no marcan ítems, de modo que no coincide
      // ninguno, que es lo correcto. Los cobros por ítems anteriores a este
      // cambio sellaron `paid_at` con un instante propio y no se pueden
      // vincular: devuelven 0 ítems liberados junto con `order_needs_review`,
      // para que el cajero los libere a mano.
      const released = await tx
        .update(schema.orderItems)
        .set({ paid_at: null })
        .where(
          and(
            eq(schema.orderItems.order_id, order.id),
            eq(schema.orderItems.paid_at, payment.created_at),
          ),
        )
        .returning({ id: schema.orderItems.id });

      // Saldo real de la orden después de la anulación.
      const [after] = await tx
        .select({ total_paid: sum(schema.payments.amount) })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, order.id),
            ...collectedPaymentConditions(),
          ),
        );
      const totalPaidAfter = Number(after?.total_paid || 0);
      const remaining = Math.max(0, order.total - totalPaidAfter);

      // Si la venta ya tiene comprobante emitido, anular el cobro NO lo deshace:
      // SUNAT exige una nota de crédito, y emitirla es competencia del área de
      // facturación. Aquí no se toca el comprobante, solo se avisa: sin este
      // dato la caja anulaba el cobro y se enteraba del descuadre tributario
      // semanas después. Se excluyen las propias notas (`reference_invoice_id`).
      const [invoice] = await tx
        .select({
          id: schema.invoices.id,
          type: schema.invoices.type,
          series: schema.invoices.series,
          number: schema.invoices.number,
          sunat_status: schema.invoices.sunat_status,
        })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.order_id, order.id),
            eq(schema.invoices.organization_id, tenant.organizationId),
            eq(schema.invoices.branch_id, tenant.branchId),
            isNull(schema.invoices.reference_invoice_id),
          ),
        )
        .orderBy(desc(schema.invoices.created_at))
        .limit(1);

      // Si la orden ya estaba 'completed' y ahora queda con saldo, NO se revierte
      // automáticamente: revertirla implicaría devolver stock y quitar puntos de
      // fidelización ya comunicados al cliente, decisiones que un sistema no
      // puede tomar solo. Se marca para revisión humana y la UI debe avisar.
      const orderNeedsReview = order.status === "completed" && remaining > 0;

      await auditFromContext(
        c,
        {
          action: "payment.void",
          entityType: "payment",
          entityId: payment.id,
          summary:
            `Anulación de cobro de S/ ${(payment.amount / 100).toFixed(2)} ` +
            `(${payment.method}) de la orden ${order.order_number}. Motivo: ${reason}`,
          before: {
            status: payment.status,
            amount: payment.amount,
            tip: payment.tip,
            method: payment.method,
            reference: payment.reference,
            cash_session_id: payment.cash_session_id,
            charged_by: payment.user_id,
            order_status: order.status,
          },
          after: {
            status: "refunded",
            voided_at: voidedAt.toISOString(),
            voided_by: userId,
            void_reason: reason,
            items_released: released.length,
            order_total_paid: totalPaidAfter,
            order_remaining: remaining,
            order_needs_review: orderNeedsReview,
            invoice_id: invoice?.id ?? null,
          },
        },
        tx,
      );

      return {
        error: null,
        order,
        payment: voided,
        itemsReleased: released.length,
        totalPaidAfter,
        remaining,
        orderNeedsReview,
        invoice: invoice ?? null,
      };
    });

    if (txResult.error) {
      const { status, code, message } = txResult.error;
      return c.json({ success: false, error: { code, message } }, status);
    }

    const {
      order,
      payment,
      itemsReleased,
      totalPaidAfter,
      remaining,
      orderNeedsReview,
      invoice,
    } = txResult;

    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "payment:voided",
      payload: {
        paymentId: payment.id,
        orderId: order.id,
        orderNumber: order.order_number,
        amount: payment.amount,
        orderNeedsReview,
        invoiceNeedsCreditNote: invoice !== null,
      },
      timestamp: Date.now(),
    });

    return c.json({
      success: true,
      data: {
        ...payment,
        order_number: order.order_number,
        order_total: order.total,
        order_status: order.status,
        items_released: itemsReleased,
        total_paid: totalPaidAfter,
        remaining,
        order_needs_review: orderNeedsReview,
        // El comprobante NO se anula aquí: la UI debe pedir nota de crédito.
        invoice_needs_credit_note: invoice !== null,
        invoice: invoice,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /:id - Detalle de un cobro
// ---------------------------------------------------------------------------

payments.get(
  "/:id",
  requirePermission("payments:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [result] = await db
      .select({
        id: schema.payments.id,
        order_id: schema.payments.order_id,
        organization_id: schema.payments.organization_id,
        branch_id: schema.payments.branch_id,
        method: schema.payments.method,
        amount: schema.payments.amount,
        reference: schema.payments.reference,
        tip: schema.payments.tip,
        status: schema.payments.status,
        user_id: schema.payments.user_id,
        cash_session_id: schema.payments.cash_session_id,
        voided_at: schema.payments.voided_at,
        voided_by: schema.payments.voided_by,
        void_reason: schema.payments.void_reason,
        created_at: schema.payments.created_at,
        order_number: schema.orders.order_number,
        order_total: schema.orders.total,
        order_status: schema.orders.status,
        cashier_name: schema.users.name,
        voided_by_name: sql<
          string | null
        >`(SELECT name FROM users WHERE users.id = ${schema.payments.voided_by})`,
      })
      .from(schema.payments)
      .leftJoin(schema.orders, eq(schema.payments.order_id, schema.orders.id))
      .leftJoin(schema.users, eq(schema.payments.user_id, schema.users.id))
      .where(
        and(
          eq(schema.payments.id, id),
          eq(schema.payments.organization_id, tenant.organizationId),
          eq(schema.payments.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!result) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Pago no encontrado" } },
        404,
      );
    }

    return c.json({
      success: true,
      data: { ...result, voided: result.voided_at !== null },
    });
  },
);

export { payments };
