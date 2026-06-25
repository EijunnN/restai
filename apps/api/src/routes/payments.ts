import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, gte, lte, sql, sum, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { createPaymentSchema, idParamSchema } from "@restai/validators";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { peruStartOfDay, peruEndOfDay } from "../lib/timezone.js";

const payments = new Hono<AppEnv>();

payments.use("*", authMiddleware);
payments.use("*", tenantMiddleware);
payments.use("*", requireBranch);

// GET /summary - Daily payment summary (must be before /:id)
payments.get("/summary", requirePermission("payments:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const startOfDay = peruStartOfDay();
  const endOfDay = peruEndOfDay();

  const conditions = [
    eq(schema.payments.branch_id, tenant.branchId),
    eq(schema.payments.organization_id, tenant.organizationId),
    eq(schema.payments.status, "completed"),
    gte(schema.payments.created_at, startOfDay),
    lte(schema.payments.created_at, endOfDay),
  ];

  // Total by method
  const byMethod = await db
    .select({
      method: schema.payments.method,
      total: sum(schema.payments.amount),
      count: sql<number>`count(*)::int`,
    })
    .from(schema.payments)
    .where(and(...conditions))
    .groupBy(schema.payments.method);

  // Grand total and tip total
  const [totals] = await db
    .select({
      grand_total: sum(schema.payments.amount),
      tip_total: sum(schema.payments.tip),
      count: sql<number>`count(*)::int`,
    })
    .from(schema.payments)
    .where(and(...conditions));

  return c.json({
    success: true,
    data: {
      byMethod: byMethod.map((m) => ({
        method: m.method,
        total: Number(m.total || 0),
        count: m.count,
      })),
      grandTotal: Number(totals?.grand_total || 0),
      tipTotal: Number(totals?.tip_total || 0),
      totalCount: totals?.count || 0,
    },
  });
});

// GET /unpaid-orders - Orders pending payment (for payment dialog selector)
payments.get("/unpaid-orders", requirePermission("payments:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  // Filter unpaid in SQL (total_paid < orders.total) before the limit so we
  // never drop unpaid orders by truncating the candidate set first.
  const result = await db
    .select({
      id: schema.orders.id,
      order_number: schema.orders.order_number,
      customer_name: schema.orders.customer_name,
      total: schema.orders.total,
      status: schema.orders.status,
      created_at: schema.orders.created_at,
      total_paid: sql<number>`COALESCE((SELECT SUM(amount)::bigint FROM payments WHERE payments.order_id = ${schema.orders.id} AND payments.status = 'completed'), 0)::int`,
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
        sql`COALESCE((SELECT SUM(amount)::bigint FROM payments WHERE payments.order_id = ${schema.orders.id} AND payments.status = 'completed'), 0) < ${schema.orders.total}`,
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

// GET / - List payments for branch with optional filters
payments.get("/", requirePermission("payments:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const method = c.req.query("method");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  const conditions: any[] = [
    eq(schema.payments.branch_id, tenant.branchId),
    eq(schema.payments.organization_id, tenant.organizationId),
  ];

  if (method) {
    conditions.push(eq(schema.payments.method, method as any));
  }
  if (startDate) {
    conditions.push(gte(schema.payments.created_at, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(schema.payments.created_at, new Date(endDate)));
  }

  const result = await db
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
      created_at: schema.payments.created_at,
      order_number: schema.orders.order_number,
    })
    .from(schema.payments)
    .leftJoin(schema.orders, eq(schema.payments.order_id, schema.orders.id))
    .where(and(...conditions))
    .orderBy(desc(schema.payments.created_at))
    .limit(100);

  return c.json({ success: true, data: result });
});

// POST / - Create payment (supports partial payments)
payments.post(
  "/",
  requirePermission("payments:create"),
  zValidator("json", createPaymentSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Serialize concurrent payments for the same order: lock the order row,
    // re-sum prior completed payments inside the tx, then cap/reject and insert.
    const txResult = await db.transaction(async (tx) => {
      // Verify order belongs to tenant + lock the row FOR UPDATE
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

      // Re-sum previous completed payments for this order inside the tx
      const [prevPayments] = await tx
        .select({
          total_paid: sum(schema.payments.amount),
        })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, body.orderId),
            eq(schema.payments.status, "completed"),
          ),
        );

      const previouslyPaid = Number(prevPayments?.total_paid || 0);

      const remaining = order.total - previouslyPaid;
      if (remaining <= 0) {
        return { error: { status: 400 as const, code: "BAD_REQUEST", message: "La orden ya está pagada" } };
      }

      // Cap payment to remaining balance
      const effectiveAmount = Math.min(body.amount, remaining);

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
        })
        .returning();

      const totalPaid = previouslyPaid + effectiveAmount;
      const fullyPaid = totalPaid >= order.total;

      return { error: null, order, payment, totalPaid, fullyPaid };
    });

    if (txResult.error) {
      const { status, code, message } = txResult.error;
      return c.json({ success: false, error: { code, message } }, status);
    }

    const { order, payment, totalPaid, fullyPaid } = txResult;

    return c.json({
      success: true,
      data: {
        ...payment,
        order_number: order.order_number,
        order_total: order.total,
        total_paid: totalPaid,
        remaining: Math.max(0, order.total - totalPaid),
        fully_paid: fullyPaid,
      },
    }, 201);
  },
);

// POST /items - Split-bill: pay for selected order items. Records a payment for
// the selected items' proportional share of the order total and marks them paid,
// so a shared table can be settled product-by-product. The cash "amount
// received"/change is purely a client concern; the recorded payment is the owed
// share. The order is finalized (loyalty/inventory) when the table is freed.
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
        if (it.paid_at) {
          return { error: { status: 409 as const, code: "CONFLICT", message: "Uno de los ítems ya fue pagado" } };
        }
      }

      const selectedSet = new Set(body.itemIds);
      const unpaidItems = allItems.filter((i) => !i.paid_at);
      const settlingAll =
        unpaidItems.length === body.itemIds.length &&
        unpaidItems.every((i) => selectedSet.has(i.id));

      const [prev] = await tx
        .select({ total_paid: sum(schema.payments.amount) })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, body.orderId),
            eq(schema.payments.status, "completed"),
          ),
        );
      const previouslyPaid = Number(prev?.total_paid || 0);
      const remainingBefore = Math.max(0, order.total - previouslyPaid);

      // Exact remaining when settling everything left (no rounding leftover);
      // otherwise the proportional share of the selected items.
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
        })
        .returning();

      // Mark the selected items paid (guarded on still-unpaid for race safety).
      await tx
        .update(schema.orderItems)
        .set({ paid_at: new Date() })
        .where(
          and(
            inArray(schema.orderItems.id, body.itemIds),
            eq(schema.orderItems.order_id, body.orderId),
            isNull(schema.orderItems.paid_at),
          ),
        );

      const totalPaid = previouslyPaid + owed;
      return { error: null, order, payment, owed, totalPaid, fullyPaid: totalPaid >= order.total };
    });

    if (txResult.error) {
      const { status, code, message } = txResult.error;
      return c.json({ success: false, error: { code, message } }, status);
    }

    const { order, payment, owed, totalPaid, fullyPaid } = txResult;
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
        },
      },
      201,
    );
  },
);

// GET /:id - Get payment details with order info
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
        created_at: schema.payments.created_at,
        order_number: schema.orders.order_number,
        order_total: schema.orders.total,
        order_status: schema.orders.status,
      })
      .from(schema.payments)
      .leftJoin(schema.orders, eq(schema.payments.order_id, schema.orders.id))
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

    return c.json({ success: true, data: result });
  },
);

export { payments };
