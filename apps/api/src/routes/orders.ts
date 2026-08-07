import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, ne, desc, sql, isNull, inArray, getTableColumns } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createOrderSchema,
  updateOrderStatusSchema,
  updateOrderItemStatusSchema,
  idParamSchema,
  orderQuerySchema,
} from "@restai/validators";
import { ORDER_STATUS_TRANSITIONS, ORDER_ITEM_STATUS_TRANSITIONS } from "@restai/config";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { realtime } from "../infrastructure/container.js";
import { z } from "zod";
import {
  createOrder,
  handleOrderCompletion,
  OrderValidationError,
  repriceOrderAfterCancel,
  persistRepricedDiscount,
} from "../services/order.service.js";
import * as loyaltyService from "../services/loyalty.service.js";
import { ACTIVE_TTL_HOURS } from "../services/session.service.js";
import { signCustomerToken } from "../lib/jwt.js";
import { auditFromContext } from "../lib/audit.js";
import { logger } from "../lib/logger.js";

const orders = new Hono<AppEnv>();

orders.use("*", authMiddleware);
orders.use("*", tenantMiddleware);
orders.use("*", requireBranch);

// ---------------------------------------------------------------------------
// Esquemas propios de esta ruta
//
// Se definen aquí (y no en @restai/validators) porque amplían contratos
// compartidos con campos que solo tienen sentido en el canal de staff.
// ---------------------------------------------------------------------------

/**
 * Cuerpo de POST / — el del validador compartido más dos campos del POS.
 *
 * `tableId`: sin él, el pedido que levanta el mozo o el cajero nacía huérfano
 * (sin `table_session_id`), no entraba en la cuenta de la mesa, cocina lo veía
 * como "Salón" y al liberar la mesa ni siquiera se cerraba.
 *
 * `customerId`: identificar al cliente en una venta de mostrador es lo que hace
 * que la fidelización exista en el canal principal del restaurante.
 */
const createOrderBodySchema = createOrderSchema.extend({
  tableId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

/** Cuerpo de PATCH /:id/status — se añade el motivo, obligatorio de auditar en las anulaciones. */
const updateOrderStatusBodySchema = updateOrderStatusSchema.extend({
  reason: z.string().max(500).optional(),
});

/**
 * Cuerpo de PATCH /:id/items/:itemId/status.
 *
 * Amplía el enum compartido con `cancelled`: la máquina de estados de
 * @restai/config ya permite anular una línea desde pending/preparing/ready (el
 * "86" de cocina: se acabó el plato), pero el validador compartido no lo
 * aceptaba, así que la transición era inalcanzable desde la API.
 */
const updateOrderItemStatusBodySchema = updateOrderItemStatusSchema.extend({
  status: z.enum(["pending", "preparing", "ready", "served", "cancelled"]),
  reason: z.string().max(500).optional(),
});

/**
 * Publica una tanda de eventos sin que un fallo de difusión tumbe la operación.
 *
 * Cuando se llama, el cambio YA está confirmado en la base de datos: devolver un
 * 500 porque el proveedor de realtime no contestó haría que el POS reintentase
 * y duplicara la comanda. Se publica en paralelo —con Ably cada `publish` es una
 * llamada HTTP y encadenarlas le añade latencia al mozo que espera la
 * confirmación— y los fallos se registran en vez de propagarse.
 */
async function broadcast(events: Array<{ room: string; message: object }>): Promise<void> {
  const results = await Promise.allSettled(
    events.map((e) => realtime.publish(e.room, e.message)),
  );
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      logger.error("No se pudo difundir un evento de orden", {
        room: events[i]?.room,
        error:
          result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });
}

/** Error de resolución de la mesa indicada por el staff al tomar el pedido. */
class TableResolutionError extends Error {
  constructor(public readonly code: "TABLE_NOT_FOUND") {
    super(code);
    this.name = "TableResolutionError";
  }
}

/**
 * Devuelve la sesión de mesa a la que debe colgarse un pedido tomado por el
 * staff, creándola si la mesa aún no tenía visita abierta.
 *
 * Todo ocurre dentro de una única transacción con la fila de la mesa bloqueada
 * (`FOR UPDATE`): dos mozos que cantan a la vez el primer pedido de la misma
 * mesa se serializan y comparten una sola sesión, en lugar de abrir dos visitas
 * paralelas que partirían la cuenta en dos.
 *
 * No se delega en `sessionService.createSession` a propósito: ese helper corre
 * sobre su propia conexión, fuera de esta transacción, así que un fallo
 * posterior dejaría una sesión huérfana viva y la mesa sin ocupar. Se sigue el
 * mismo patrón que ya usa el "sentar walk-in" de routes/tables.ts.
 */
async function resolveStaffTableSession(params: {
  tableId: string;
  branchId: string;
  organizationId: string;
  customerName?: string | null;
}): Promise<{
  sessionId: string;
  tableNumber: number;
  /** Nombre con el que quedó registrada la visita (para el evento del salón). */
  sessionCustomerName: string;
  created: boolean;
  /** La mesa figuraba libre y esta petición la marcó ocupada. */
  tableOccupied: boolean;
  /** Estado que tenía la mesa antes de ocuparla, para poder deshacer. */
  previousTableStatus: "available" | "occupied" | "reserved" | "maintenance";
}> {
  return await db.transaction(async (tx) => {
    const [table] = await tx
      .select({
        id: schema.tables.id,
        number: schema.tables.number,
        status: schema.tables.status,
      })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, params.tableId),
          eq(schema.tables.branch_id, params.branchId),
          eq(schema.tables.organization_id, params.organizationId),
        ),
      )
      .limit(1)
      .for("update");

    if (!table) {
      throw new TableResolutionError("TABLE_NOT_FOUND");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACTIVE_TTL_HOURS * 3_600_000);

    // ¿Ya hay visita abierta? Se reutiliza la más reciente, incluso si su TTL
    // venció: si el mozo está cantando un pedido en esa mesa, la visita está
    // viva de facto. Se le renueva la caducidad para que el expirador
    // automático no la cierre con comida en marcha.
    // Se buscan las visitas VIVAS, no solo las activas.
    //
    // Una solicitud de ingreso todavía `pending` (el comensal escaneó el QR y
    // espera aprobación) también ocupa la mesa. Mirar solo las `active` abría un
    // callejón sin salida: el mozo cantaba el pedido, se creaba una SEGUNDA
    // visita activa, y a partir de ahí el índice único `uq_table_sessions_one_active`
    // rechazaba la aprobación del comensal para siempre. Si hay una pendiente,
    // se PROMOCIONA a activa en vez de abrir otra: el pedido del mozo y la
    // entrada del comensal acaban en la misma cuenta, que es lo que ambos
    // esperan.
    const [live] = await tx
      .select({
        id: schema.tableSessions.id,
        customer_name: schema.tableSessions.customer_name,
        status: schema.tableSessions.status,
      })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, table.id),
          eq(schema.tableSessions.branch_id, params.branchId),
          // Aunque la mesa ya está acotada al tenant, la sesión se filtra
          // también por organización: ninguna consulta de esta ruta puede
          // depender de que otra tabla haya filtrado por ella.
          eq(schema.tableSessions.organization_id, params.organizationId),
          inArray(schema.tableSessions.status, ["active", "pending"]),
        ),
      )
      // La activa manda sobre la pendiente; a igualdad, la más reciente.
      .orderBy(
        sql`CASE WHEN ${schema.tableSessions.status} = 'active' THEN 0 ELSE 1 END`,
        desc(schema.tableSessions.started_at),
      )
      .limit(1);

    const active = live;

    if (active) {
      await tx
        .update(schema.tableSessions)
        .set({
          expires_at: expiresAt,
          // Promoción de pendiente -> activa: el mozo tomando el pedido en esa
          // mesa es una aprobación de facto.
          ...(active.status === "pending" ? { status: "active" as const } : {}),
        })
        .where(eq(schema.tableSessions.id, active.id));

      // Autocuración: una mesa con visita activa tiene que figurar ocupada.
      const needsOccupying = table.status !== "occupied";
      if (needsOccupying) {
        await tx
          .update(schema.tables)
          .set({ status: "occupied" })
          .where(eq(schema.tables.id, table.id));
      }

      return {
        sessionId: active.id,
        tableNumber: table.number,
        sessionCustomerName: active.customer_name ?? `Mesa ${table.number}`,
        created: false,
        // Si la autocuración cambió el estado, el salón tiene que enterarse
        // igual que si se acabara de sentar a alguien: si no, el plano sigue
        // pintando libre una mesa con comida en marcha.
        tableOccupied: needsOccupying,
        previousTableStatus: table.status,
      };
    }

    // No hay visita: se abre una de staff. El token se firma con `sub` fijado al
    // id de la fila (ver sessionService.createSession) para que, si luego se le
    // pasa el enlace al comensal, requireActiveSession lo encuentre.
    const sessionId = crypto.randomUUID();
    const token = await signCustomerToken({
      sub: sessionId,
      org: params.organizationId,
      branch: params.branchId,
      table: table.id,
    });
    const sessionCustomerName = params.customerName?.trim() || `Mesa ${table.number}`;

    const [created] = await tx
      .insert(schema.tableSessions)
      .values({
        id: sessionId,
        table_id: table.id,
        branch_id: params.branchId,
        organization_id: params.organizationId,
        customer_name: sessionCustomerName,
        token,
        status: "active",
        expires_at: expiresAt,
      })
      .returning({ id: schema.tableSessions.id });

    await tx
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, table.id));

    return {
      sessionId: created.id,
      tableNumber: table.number,
      sessionCustomerName,
      created: true,
      tableOccupied: table.status !== "occupied",
      previousTableStatus: table.status,
    };
  });
}

/**
 * Deshace una sesión que se acababa de abrir para un pedido que finalmente no
 * llegó a crearse (carta desactualizada, modificador inválido, stock…).
 *
 * Sin esto, un pedido rechazado dejaba la mesa ocupada con una visita vacía que
 * había que liberar a mano.
 *
 * La limpieza es CONDICIONAL: entre que esta petición abrió la sesión y que su
 * pedido fue rechazado, otro mozo pudo cantar un pedido en la misma mesa y
 * engancharse a esta misma visita. Como `orders.table_session_id` es ON DELETE
 * SET NULL, borrarla a ciegas dejaría el pedido del compañero sin mesa —
 * exactamente el defecto que este trabajo venía a arreglar. Por eso se borra
 * solo si no cuelga ningún pedido de ella, y la mesa solo se devuelve a su
 * estado anterior si el borrado ocurrió de verdad.
 *
 * Nunca lanza: el error que se está devolviendo al mozo es más importante que
 * la limpieza.
 */
async function rollbackOpenedSession(params: {
  sessionId: string;
  tableId: string;
  branchId: string;
  organizationId: string;
  previousTableStatus: "available" | "occupied" | "reserved" | "maintenance";
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [attached] = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.orders)
        .where(eq(schema.orders.table_session_id, params.sessionId));

      if ((attached?.count ?? 0) > 0) {
        logger.warn("Sesión de mesa conservada: otro pedido ya se enganchó a ella", {
          sessionId: params.sessionId,
          tableId: params.tableId,
        });
        return;
      }

      const deleted = await tx
        .delete(schema.tableSessions)
        .where(
          and(
            eq(schema.tableSessions.id, params.sessionId),
            eq(schema.tableSessions.branch_id, params.branchId),
            eq(schema.tableSessions.organization_id, params.organizationId),
          ),
        )
        .returning({ id: schema.tableSessions.id });

      if (deleted.length === 0) return;

      await tx
        .update(schema.tables)
        .set({ status: params.previousTableStatus })
        .where(
          and(
            eq(schema.tables.id, params.tableId),
            eq(schema.tables.branch_id, params.branchId),
            eq(schema.tables.organization_id, params.organizationId),
          ),
        );
    });
  } catch (err) {
    logger.error("No se pudo deshacer la sesión de mesa abierta por un pedido fallido", {
      sessionId: params.sessionId,
      tableId: params.tableId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// GET / - List orders
orders.get("/", requirePermission("orders:read"), zValidator("query", orderQuerySchema), async (c) => {
  const tenant = c.get("tenant") as any;
  const { status, page, limit } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions = [
    eq(schema.orders.branch_id, tenant.branchId),
    eq(schema.orders.organization_id, tenant.organizationId),
  ];

  if (status) {
    conditions.push(eq(schema.orders.status, status as any));
  }

  const whereClause = and(...conditions);

  const [result, countResult] = await Promise.all([
    db
      .select({
        ...getTableColumns(schema.orders),
        // Las líneas anuladas ("86") no cuentan: enseñar 3 productos en una
        // comanda de la que se cayeron 2 es mentirle al operador.
        item_count: sql<number>`(SELECT COUNT(*)::int FROM order_items WHERE order_items.order_id = ${schema.orders.id} AND order_items.status <> 'cancelled')`,
        // Un cobro anulado deja de ser dinero cobrado. Sin el filtro por
        // `voided_at` (columna nueva de la 0012) esta lista seguía marcando como
        // "pagada" una orden cuyo cobro se revirtió. Mismo criterio canónico
        // que usa payments.ts.
        total_paid: sql<number>`COALESCE((SELECT SUM(amount)::int FROM payments WHERE payments.order_id = ${schema.orders.id} AND payments.status = 'completed' AND payments.voided_at IS NULL), 0)`,
        table_number: schema.tables.number,
      })
      .from(schema.orders)
      .leftJoin(schema.tableSessions, eq(schema.orders.table_session_id, schema.tableSessions.id))
      .leftJoin(schema.tables, eq(schema.tableSessions.table_id, schema.tables.id))
      .where(whereClause)
      .orderBy(desc(schema.orders.created_at))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.orders)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  const enriched = result.map((order) => {
    const paid = order.total_paid ?? 0;
    const orderTotal = order.total ?? 0;
    const paymentStatus = paid >= orderTotal && orderTotal > 0
      ? "paid"
      : paid > 0
        ? "partial"
        : "unpaid";
    return { ...order, payment_status: paymentStatus };
  });

  return c.json({
    success: true,
    data: enriched,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// POST / - Create order
orders.post(
  "/",
  requirePermission("orders:create"),
  zValidator("json", createOrderBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;
    const isCustomerOrder = user.role === "customer";

    // ── Cliente ───────────────────────────────────────────────────────────
    // El cliente se resuelve SIEMPRE que venga, no solo cuando hay cupón o
    // canje. Antes solo se leía dentro del `if (couponCode || redemptionId)`,
    // así que ninguna venta de mostrador otorgaba puntos: la fidelización
    // quedaba muerta justo en el canal por el que pasa la mayor parte de la
    // facturación. Se valida siempre la pertenencia a la organización antes de
    // confiar en el id que manda el cliente HTTP.
    let customerId: string | null = null;
    if (body.customerId) {
      const [owned] = await db
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.id, body.customerId),
            eq(schema.customers.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);
      if (!owned) {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
          404,
        );
      }
      customerId = owned.id;
    }

    // ── Mesa / sesión ─────────────────────────────────────────────────────
    let tableSessionId: string | null = null;
    let tableNumber: number | null = null;
    let openedSession:
      | {
          sessionId: string;
          tableId: string;
          tableNumber: number;
          customerName: string;
          previousTableStatus: "available" | "occupied" | "reserved" | "maintenance";
        }
      | null = null;
    /** La mesa estaba marcada libre y este pedido la puso en ocupada. */
    let tableTurnedOccupied = false;

    if (isCustomerOrder) {
      // El comensal ya viene atado a su mesa por el token.
      const [session] = await db
        .select({ id: schema.tableSessions.id, number: schema.tables.number })
        .from(schema.tableSessions)
        .innerJoin(schema.tables, eq(schema.tableSessions.table_id, schema.tables.id))
        .where(
          and(
            eq(schema.tableSessions.table_id, user.table),
            // La mesa del token se comprueba contra el tenant del contexto: un
            // token con un `table` de otra sede no puede colgar pedidos aquí.
            eq(schema.tableSessions.branch_id, tenant.branchId),
            eq(schema.tableSessions.organization_id, tenant.organizationId),
            eq(schema.tableSessions.status, "active"),
          ),
        )
        .limit(1);
      tableSessionId = session?.id || null;
      tableNumber = session?.number ?? null;
    } else if (body.tableId) {
      // Pedido del staff sobre una mesa concreta: se cuelga de la visita abierta
      // o se abre una nueva, con la mesa marcada como ocupada.
      try {
        const resolved = await resolveStaffTableSession({
          tableId: body.tableId,
          branchId: tenant.branchId,
          organizationId: tenant.organizationId,
          customerName: body.customerName,
        });
        tableSessionId = resolved.sessionId;
        tableNumber = resolved.tableNumber;
        tableTurnedOccupied = resolved.tableOccupied;
        if (resolved.created) {
          openedSession = {
            sessionId: resolved.sessionId,
            tableId: body.tableId,
            tableNumber: resolved.tableNumber,
            customerName: resolved.sessionCustomerName,
            previousTableStatus: resolved.previousTableStatus,
          };
        }
      } catch (err) {
        if (err instanceof TableResolutionError) {
          return c.json(
            { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada en esta sede" } },
            404,
          );
        }
        throw err;
      }
    }

    let result;
    try {
      result = await createOrder({
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
        items: body.items,
        type: body.type,
        customerName: body.customerName,
        notes: body.notes,
        tableSessionId,
        customerId,
        couponCode: body.couponCode || null,
        redemptionId: body.redemptionId || null,
        deliveryAddress: body.deliveryAddress,
        deliveryPhone: body.deliveryPhone,
        deliveryFee: body.deliveryFee,
        deliveryDriverId: body.deliveryDriverId,
      });
    } catch (err) {
      // El pedido no llegó a nacer: si esta petición abrió la mesa, se deshace
      // para no dejarla ocupada con una visita fantasma.
      if (openedSession) {
        await rollbackOpenedSession({
          sessionId: openedSession.sessionId,
          tableId: openedSession.tableId,
          branchId: tenant.branchId,
          organizationId: tenant.organizationId,
          previousTableStatus: openedSession.previousTableStatus,
        });
      }
      if (err instanceof OrderValidationError) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: err.message } },
          400,
        );
      }
      throw err;
    }

    let { order } = result;
    const { items: createdItems } = result;

    // ── Autoría ───────────────────────────────────────────────────────────
    // Quién levantó la comanda. `createOrder` es un servicio compartido que hoy
    // no recibe el autor, así que la orden se sella justo después de crearse.
    // Sin esto no hay ventas por mozo, ni comisiones, ni forma de saber quién
    // metió un pedido que nadie reclama. Un fallo aquí no puede tumbar un
    // pedido que ya existe y es cobrable: se registra y se sigue.
    if (!isCustomerOrder && typeof user.sub === "string") {
      try {
        const [stamped] = await db
          .update(schema.orders)
          .set({ created_by: user.sub })
          .where(
            and(
              eq(schema.orders.id, order.id),
              eq(schema.orders.branch_id, tenant.branchId),
              eq(schema.orders.organization_id, tenant.organizationId),
            ),
          )
          .returning();
        if (stamped) order = stamped;
      } catch (err) {
        logger.error("No se pudo registrar la autoría del pedido", {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Si el pedido abrió la mesa, el salón tiene que enterarse igual que cuando
    // se sienta un walk-in desde /tables. Los eventos se acumulan y se publican
    // de una vez al final: con un proveedor remoto (Ably) cada publish es una
    // llamada HTTP, y encadenarlas de una en una le añade latencia al POS
    // justo cuando el mozo está esperando la confirmación de la comanda.
    const events: Array<{ room: string; message: object }> = [];

    if (openedSession) {
      events.push({
        room: `branch:${tenant.branchId}`,
        message: {
          type: "session:started",
          payload: {
            sessionId: openedSession.sessionId,
            tableId: openedSession.tableId,
            tableNumber: openedSession.tableNumber,
            customerName: openedSession.customerName,
          },
          timestamp: Date.now(),
        },
      });
    }

    // El cambio de estado de la mesa se anuncia tanto si la visita es nueva como
    // si se reutilizó una activa que había quedado descuadrada (mesa marcada
    // libre con sesión viva): en ambos casos el plano del salón estaba pintando
    // una mesa libre que ya no lo está.
    if (tableTurnedOccupied && body.tableId) {
      events.push({
        room: `branch:${tenant.branchId}`,
        message: {
          type: "table:status",
          payload: {
            tableId: body.tableId,
            number: tableNumber,
            status: "occupied",
          },
          timestamp: Date.now(),
        },
      });
    }

    // Auto-create payment intent if paymentMethod is provided (delivery flow).
    // We do NOT trust the client's isPaid flag to mark collection as completed:
    // there is no real capture/gateway here, so recording 'completed' would book
    // revenue that was never captured. The payment is always created as 'pending'
    // and must be settled through the cashier/payments flow. A failure to record
    // the intent must not break the already-created order.
    if (body.paymentMethod) {
      try {
        await db.insert(schema.payments).values({
          order_id: order.id,
          organization_id: tenant.organizationId,
          branch_id: tenant.branchId,
          method: body.paymentMethod as any,
          amount: order.total,
          status: "pending",
          reference: body.isPaid ? "Cliente declaró prepago (pendiente de captura)" : null,
        });
      } catch {
        // Order is already committed; surface it without the payment intent.
      }
    }

    // Difusión del pedido nuevo. El KDS solo escucha el canal `:kitchen`, así
    // que publicar únicamente en `branch:{id}` dejaba la cocina a ciegas.
    const orderPayload = {
      type: "order:new",
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        status: order.status,
        tableSessionId: order.table_session_id,
        tableNumber,
        items: createdItems.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          status: i.status,
          notes: i.notes,
        })),
      },
      timestamp: Date.now(),
    };
    events.push({ room: `branch:${tenant.branchId}`, message: orderPayload });
    events.push({ room: `branch:${tenant.branchId}:kitchen`, message: orderPayload });
    // El comensal sentado en esa mesa ve su pedido aparecer aunque lo haya
    // cantado el mozo.
    if (order.table_session_id) {
      events.push({ room: `session:${order.table_session_id}`, message: orderPayload });
    }

    await broadcast(events);

    return c.json({ success: true, data: { ...order, items: createdItems, table_number: tableNumber } }, 201);
  },
);

// GET /:id - Get order with items
orders.get(
  "/:id",
  requirePermission("orders:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.branch_id, tenant.branchId),
          // También por organización: el resto de la ruta lo hace y aquí
          // faltaba, así que el detalle era el único punto que se fiaba de que
          // el id de sede bastara para acotar el tenant.
          eq(schema.orders.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!order) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
        404,
      );
    }

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.order_id, order.id));

    return c.json({ success: true, data: { ...order, items } });
  },
);

// PATCH /:id/status
orders.patch(
  "/:id/status",
  requirePermission("orders:update_status"),
  zValidator("param", idParamSchema),
  zValidator("json", updateOrderStatusBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { status, reason } = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;
    const actorId = user?.role !== "customer" && typeof user?.sub === "string" ? user.sub : null;
    const cancelReason = reason?.trim() || null;

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.branch_id, tenant.branchId),
          eq(schema.orders.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!order) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
        404,
      );
    }

    const allowed = ORDER_STATUS_TRANSITIONS[order.status];
    if (!allowed?.includes(status)) {
      return c.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: `No se puede cambiar de "${order.status}" a "${status}"` },
        },
        400,
      );
    }

    // Cascada de estado del pedido a sus líneas: el Kanban solo mueve la ORDEN,
    // así que sin esto `order_items.status` se quedaba en 'pending' ("En cola")
    // para siempre en la pantalla del comensal. Nunca se pisa una línea ya
    // anulada.
    const ITEM_CASCADE: Record<string, "preparing" | "ready" | "served"> = {
      preparing: "preparing",
      ready: "ready",
      served: "served",
      completed: "served",
    };

    const now = new Date();

    // Transición + cascada en una sola transacción: o cambian la orden y sus
    // líneas, o no cambia nada. El UPDATE lleva el estado leído en el WHERE
    // (compare-and-swap), así que dos peticiones concurrentes no pueden ganar
    // las dos; la perdedora recibe 409.
    const outcome = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.orders)
        .set({ status, updated_at: now })
        .where(
          and(
            eq(schema.orders.id, id),
            eq(schema.orders.branch_id, tenant.branchId),
            eq(schema.orders.organization_id, tenant.organizationId),
            eq(schema.orders.status, order.status),
          ),
        )
        .returning();

      if (!updated) return null;

      let releasedItems: Array<{ id: string; name: string; quantity: number }> = [];
      /** Dinero ya cobrado y NO anulado que sigue colgando de la orden. */
      let liveCollected = 0;

      if (status === "cancelled") {
        // Se liberan las líneas NO pagadas: dejan de estar pendientes en cocina
        // y dejan de sumar en la cuenta de la mesa. Las líneas ya cobradas se
        // respetan: revertir dinero es competencia del flujo de anulación de
        // pagos, no de un cambio de estado de comanda.
        releasedItems = await tx
          .update(schema.orderItems)
          .set({
            status: "cancelled",
            cancelled_at: now,
            cancel_reason: cancelReason ?? "Orden anulada",
            cancelled_by: actorId,
          })
          .where(
            and(
              eq(schema.orderItems.order_id, id),
              ne(schema.orderItems.status, "cancelled"),
              isNull(schema.orderItems.paid_at),
            ),
          )
          .returning({
            id: schema.orderItems.id,
            name: schema.orderItems.name,
            quantity: schema.orderItems.quantity,
          });

        // Aquí no se revierte dinero (eso es competencia de payments), pero sí
        // se mide: una orden anulada que conserva cobros vivos es justo el caso
        // que hay que poder encontrar en la auditoría el lunes por la mañana.
        const [collected] = await tx
          .select({ amount: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)::int` })
          .from(schema.payments)
          .where(
            and(
              eq(schema.payments.order_id, id),
              eq(schema.payments.organization_id, tenant.organizationId),
              eq(schema.payments.status, "completed"),
              isNull(schema.payments.voided_at),
            ),
          );
        liveCollected = collected?.amount ?? 0;
      } else {
        const itemTarget = ITEM_CASCADE[status];
        if (itemTarget) {
          await tx
            .update(schema.orderItems)
            .set({ status: itemTarget })
            .where(
              and(
                eq(schema.orderItems.order_id, id),
                ne(schema.orderItems.status, "cancelled"),
              ),
            );
        }
      }

      return { updated, releasedItems, liveCollected };
    });

    if (!outcome) {
      return c.json(
        {
          success: false,
          error: { code: "CONFLICT", message: "La orden fue modificada por otra operación. Intenta de nuevo." },
        },
        409,
      );
    }

    const { updated, releasedItems, liveCollected } = outcome;

    // Traza de la anulación: importe y motivo, que es exactamente lo que se
    // pregunta el dueño el lunes por la mañana.
    if (status === "cancelled") {
      await auditFromContext(c, {
        action: "order.cancel",
        entityType: "order",
        entityId: updated.id,
        summary:
          `Orden ${updated.order_number} anulada por S/ ${(updated.total / 100).toFixed(2)}` +
          (cancelReason ? ` — motivo: ${cancelReason}` : " — sin motivo indicado") +
          (liveCollected > 0
            ? ` — ATENCIÓN: conserva S/ ${(liveCollected / 100).toFixed(2)} cobrados sin anular`
            : ""),
        before: { status: order.status, total: order.total },
        after: {
          status: updated.status,
          reason: cancelReason,
          released_items: releasedItems.length,
          live_collected: liveCollected,
        },
      });
    }

    const updatePayload = {
      type: status === "cancelled" ? "order:cancelled" : "order:updated",
      payload: {
        orderId: updated.id,
        orderNumber: updated.order_number,
        status: updated.status,
        ...(status === "cancelled"
          ? { reason: cancelReason, releasedItems }
          : {}),
      },
      timestamp: Date.now(),
    };
    await broadcast([
      { room: `branch:${tenant.branchId}`, message: updatePayload },
      // El KDS solo está suscrito a `branch:{id}:kitchen`: sin esta segunda
      // publicación la cocina puede tardar hasta el siguiente refresco en
      // enterarse de que un plato ya no hay que hacerlo.
      { room: `branch:${tenant.branchId}:kitchen`, message: updatePayload },
      // El comensal ve el cambio (incluida la anulación) en su pantalla.
      ...(order.table_session_id
        ? [{ room: `session:${order.table_session_id}`, message: updatePayload }]
        : []),
    ]);

    // Efectos de la finalización (puntos de fidelidad + descuento de inventario).
    // Se usan los importes de la fila ACTUALIZADA, no los leídos antes de la
    // transición: si entre medias se anuló una línea y se recalculó la cuenta,
    // los puntos deben otorgarse sobre lo que el cliente pagó de verdad.
    if (status === "completed") {
      await handleOrderCompletion({
        orderId: updated.id,
        orderNumber: updated.order_number,
        orderSubtotal: updated.subtotal,
        orderDiscount: updated.discount,
        customerId: updated.customer_id,
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
      });
    }

    return c.json({ success: true, data: updated });
  },
);

// PATCH /:id/items/:itemId/status
orders.patch(
  "/:id/items/:itemId/status",
  requirePermission("orders:update_item_status"),
  zValidator("param", z.object({ id: z.string().uuid(), itemId: z.string().uuid() })),
  zValidator("json", updateOrderItemStatusBodySchema),
  async (c) => {
    const { id, itemId } = c.req.valid("param");
    const { status, reason } = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;
    const actorId = user?.role !== "customer" && typeof user?.sub === "string" ? user.sub : null;
    const cancelReason = reason?.trim() || null;

    // Verify order belongs to branch
    const [order] = await db
      .select({
        id: schema.orders.id,
        order_number: schema.orders.order_number,
        table_session_id: schema.orders.table_session_id,
        subtotal: schema.orders.subtotal,
        discount: schema.orders.discount,
        tax: schema.orders.tax,
        total: schema.orders.total,
        delivery_fee: schema.orders.delivery_fee,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.branch_id, tenant.branchId),
          eq(schema.orders.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!order) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
        404,
      );
    }

    const [item] = await db
      .select()
      .from(schema.orderItems)
      .where(
        and(
          eq(schema.orderItems.id, itemId),
          eq(schema.orderItems.order_id, id),
        ),
      )
      .limit(1);

    if (!item) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    const allowed = ORDER_ITEM_STATUS_TRANSITIONS[item.status];
    if (!allowed?.includes(status)) {
      return c.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: `No se puede cambiar de "${item.status}" a "${status}"` },
        },
        400,
      );
    }

    // Una línea ya cobrada no se anula desde cocina: el dinero entró y revertirlo
    // es competencia del flujo de anulación de pagos.
    if (status === "cancelled" && item.paid_at) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "Esta línea ya fue cobrada: anula el pago antes de anular el producto",
          },
        },
        409,
      );
    }

    const now = new Date();

    const { updated, recalculated, totalBefore } = await db.transaction(async (tx) => {
      // Cerrojo sobre el PEDIDO antes de tocar la línea. Sin él, dos
      // anulaciones simultáneas de líneas distintas leían cada una un subtotal
      // que todavía incluía la línea que la otra estaba anulando, y la última
      // en escribir dejaba la cuenta inflada (actualización perdida: el cliente
      // acababa pagando un plato que nunca salió). Además serializa con el
      // cobro —payments.ts bloquea esta misma fila antes de registrar dinero—,
      // así que no se puede cerrar un cobro contra un total que está a punto de
      // cambiar. El cerrojo se toma en el mismo orden que en el resto del repo
      // (orders → order_items / payments); sin ese orden común aparecen
      // interbloqueos.
      const [locked] = await tx
        .select({
          status: schema.orders.status,
          discount: schema.orders.discount,
          delivery_fee: schema.orders.delivery_fee,
          total: schema.orders.total,
        })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.id, id),
            eq(schema.orders.branch_id, tenant.branchId),
            eq(schema.orders.organization_id, tenant.organizationId),
          ),
        )
        .limit(1)
        .for("update");

      if (!locked) {
        return { updated: null, recalculated: null, totalBefore: order.total };
      }

      const [row] = await tx
        .update(schema.orderItems)
        .set(
          status === "cancelled"
            ? {
                status,
                cancelled_at: now,
                cancel_reason: cancelReason ?? "Producto anulado",
                cancelled_by: actorId,
              }
            : { status },
        )
        .where(
          and(
            eq(schema.orderItems.id, itemId),
            eq(schema.orderItems.order_id, id),
            // Compare-and-swap: si otra pantalla ya movió la línea, no se pisa.
            eq(schema.orderItems.status, item.status),
            // El "ya está cobrada" se comprueba arriba para dar un mensaje
            // claro, pero se repite aquí DENTRO de la transacción: entre la
            // lectura y este UPDATE la caja pudo cobrar la línea, y anularla
            // después dejaría dinero cobrado sin producto. Si eso pasa el
            // UPDATE no toca nada y la petición se va con 409.
            ...(status === "cancelled" ? [isNull(schema.orderItems.paid_at)] : []),
          ),
        )
        .returning();

      if (!row) return { updated: null, recalculated: null, totalBefore: locked.total };

      // Al anular una línea hay que rehacer los importes del pedido; si no, el
      // cliente paga un plato que nunca salió de cocina. Solo se recalcula
      // mientras no haya cobros vivos: con dinero ya recibido, cuadrar la
      // diferencia es trabajo de caja (anular el pago), no de esta ruta.
      if (status !== "cancelled") {
        return { updated: row, recalculated: null, totalBefore: locked.total };
      }

      // Un pedido ya cerrado (completado o anulado) tampoco se re-tarifica: sus
      // puntos de fidelidad y su descuento de inventario se calcularon sobre el
      // importe anterior, y cambiarlo ahora descuadraría el histórico.
      if (locked.status === "completed" || locked.status === "cancelled") {
        return { updated: row, recalculated: null, totalBefore: locked.total };
      }

      const [paidRow] = await tx
        .select({ paid: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)::int` })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, id),
            eq(schema.payments.organization_id, tenant.organizationId),
            eq(schema.payments.status, "completed"),
            isNull(schema.payments.voided_at),
          ),
        );

      if ((paidRow?.paid ?? 0) > 0) {
        return { updated: row, recalculated: null, totalBefore: locked.total };
      }

      // Re-tarificación COMPARTIDA con el "86" de cocina.
      //
      // Este bloque tenía su propia versión (`Math.min(discount, subtotal)`, sin
      // rama de anulación total y sin re-prorratear el cupón), así que anular la
      // misma línea por dos caminos distintos podía dejar dos totales distintos.
      // Que dos rutas calculen el mismo dinero de formas diferentes es una bomba
      // contable: ahora ambas llaman a la misma función.
      const totals = await repriceOrderAfterCancel(
        {
          orderId: id,
          organizationId: tenant.organizationId,
          branchId: tenant.branchId,
          previousDiscount: locked.discount,
          deliveryFee: locked.delivery_fee,
        },
        tx,
      );

      const [reprice] = await tx
        .update(schema.orders)
        .set({
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          updated_at: now,
        })
        .where(eq(schema.orders.id, id))
        .returning({
          subtotal: schema.orders.subtotal,
          discount: schema.orders.discount,
          tax: schema.orders.tax,
          total: schema.orders.total,
        });

      // El cupón se re-prorratea con el nuevo subtotal: sin esto, un 20 % sobre
      // una cuenta a la que se le quita medio pedido se convertía en un 40 %.
      await persistRepricedDiscount(totals, tx);

      return { updated: row, recalculated: reprice ?? null, totalBefore: locked.total };
    });

    if (!updated) {
      return c.json(
        {
          success: false,
          error: { code: "CONFLICT", message: "La línea fue modificada por otra operación. Intenta de nuevo." },
        },
        409,
      );
    }

    if (status === "cancelled") {
      await auditFromContext(c, {
        action: "order_item.cancel",
        entityType: "order_item",
        entityId: updated.id,
        summary:
          `Anulado ${updated.quantity} x ${updated.name} (S/ ${(updated.total / 100).toFixed(2)}) ` +
          `de la orden ${order.order_number}` +
          (cancelReason ? ` — motivo: ${cancelReason}` : " — sin motivo indicado"),
        // Los importes se toman de la fila bloqueada dentro de la transacción,
        // no de la lectura previa: entre una y otra pudo cambiar la cuenta.
        before: { status: item.status, order_total: totalBefore },
        after: {
          status: updated.status,
          reason: cancelReason,
          order_total: recalculated?.total ?? totalBefore,
          repriced: recalculated !== null,
        },
      });
    }

    const itemPayload = {
      type: "order:item_status",
      payload: {
        orderId: id,
        orderNumber: order.order_number,
        item: { id: updated.id, name: updated.name, quantity: updated.quantity, status: updated.status },
        ...(status === "cancelled" ? { reason: cancelReason, orderTotals: recalculated } : {}),
      },
      timestamp: Date.now(),
    };
    await broadcast([
      { room: `branch:${tenant.branchId}`, message: itemPayload },
      // El KDS solo escucha `branch:{id}:kitchen`.
      { room: `branch:${tenant.branchId}:kitchen`, message: itemPayload },
      ...(order.table_session_id
        ? [{ room: `session:${order.table_session_id}`, message: itemPayload }]
        : []),
    ]);

    return c.json({ success: true, data: updated });
  },
);

// POST /:id/void - Reverse loyalty points awarded for a COMPLETED order.
// This is the post-completion clawback: when an order is voided/refunded after
// completion, the points it earned must be removed. Idempotent (voidOrderPoints
// no-ops if already reversed). Requires an elevated permission.
//
// `orders:void` es deliberadamente distinto de `orders:update`: la cocina avanza
// estados pero no puede revertir puntos de fidelidad de una venta cerrada.
orders.post(
  "/:id/void",
  requirePermission("orders:void"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // El motivo llega en un cuerpo opcional: se lee a mano en vez de con
    // zValidator porque los clientes actuales hacen POST sin cuerpo y un
    // validador de JSON obligatorio los rompería con un 400.
    let voidReason: string | null = null;
    try {
      const raw = await c.req.json();
      if (typeof raw?.reason === "string" && raw.reason.trim()) {
        voidReason = raw.reason.trim().slice(0, 500);
      }
    } catch {
      // Sin cuerpo: la anulación sigue siendo válida, solo queda sin motivo.
    }

    // Ensure the order exists, belongs to this tenant, and is completed.
    const [order] = await db
      .select({
        id: schema.orders.id,
        status: schema.orders.status,
        order_number: schema.orders.order_number,
        total: schema.orders.total,
        customer_id: schema.orders.customer_id,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.branch_id, tenant.branchId),
          eq(schema.orders.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!order) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
        404,
      );
    }

    if (order.status !== "completed") {
      return c.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "Solo se pueden anular los puntos de una orden completada",
          },
        },
        400,
      );
    }

    // Reverse the awarded points (idempotent on order_id inside the service).
    const result = await loyaltyService.voidOrderPoints({
      organizationId: tenant.organizationId,
      orderId: order.id,
    });

    logger.info("Order loyalty points voided", {
      orderId: order.id,
      orderNumber: order.order_number,
    });

    // Traza con importe y motivo: anular una venta cerrada es una de las
    // operaciones que más se pregunta a posteriori.
    await auditFromContext(c, {
      action: "order.void",
      entityType: "order",
      entityId: order.id,
      summary:
        `Anulados los puntos de la orden ${order.order_number} ` +
        `(venta de S/ ${(order.total / 100).toFixed(2)}, ${result.pointsReversed} puntos revertidos)` +
        (voidReason ? ` — motivo: ${voidReason}` : " — sin motivo indicado"),
      before: { status: order.status, total: order.total, customer_id: order.customer_id },
      after: {
        reason: voidReason,
        reversed: result.reversed,
        points_reversed: result.pointsReversed,
      },
    });

    return c.json({ success: true, data: result });
  },
);

export { orders };
