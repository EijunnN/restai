import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, sql, getTableColumns } from "drizzle-orm";
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
import { wsManager } from "../ws/manager.js";
import { z } from "zod";
import { createOrder, handleOrderCompletion, OrderValidationError } from "../services/order.service.js";
import * as loyaltyService from "../services/loyalty.service.js";
import { logger } from "../lib/logger.js";

const orders = new Hono<AppEnv>();

orders.use("*", authMiddleware);
orders.use("*", tenantMiddleware);
orders.use("*", requireBranch);

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
        item_count: sql<number>`(SELECT COUNT(*)::int FROM order_items WHERE order_items.order_id = ${schema.orders.id})`,
        total_paid: sql<number>`COALESCE((SELECT SUM(amount)::int FROM payments WHERE payments.order_id = ${schema.orders.id} AND payments.status = 'completed'), 0)`,
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
  zValidator("json", createOrderSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;

    // Determine table_session_id for customer
    let tableSessionId: string | null = null;
    if (user.role === "customer") {
      const [session] = await db
        .select({ id: schema.tableSessions.id })
        .from(schema.tableSessions)
        .where(
          and(
            eq(schema.tableSessions.table_id, user.table),
            eq(schema.tableSessions.status, "active"),
          ),
        )
        .limit(1);
      tableSessionId = session?.id || null;
    }

    // Resolve a customer for this STAFF/POS order so coupon/redemption ownership
    // can be enforced. The validated body strips unknown keys, so the optional
    // customerId is read from the raw JSON, validated as a UUID, and verified to
    // belong to this organization before we trust it.
    let customerId: string | null = null;
    if ((body.couponCode || body.redemptionId)) {
      let rawCustomerId: unknown;
      try {
        const raw = await c.req.json();
        rawCustomerId = raw?.customerId;
      } catch {
        rawCustomerId = undefined;
      }

      if (typeof rawCustomerId === "string" && rawCustomerId.length > 0) {
        const parsed = z.string().uuid().safeParse(rawCustomerId);
        if (!parsed.success) {
          return c.json(
            { success: false, error: { code: "BAD_REQUEST", message: "customerId inválido" } },
            400,
          );
        }
        // Verify the customer belongs to this tenant (org scope).
        const [owned] = await db
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(
            and(
              eq(schema.customers.id, parsed.data),
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
      if (err instanceof OrderValidationError) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: err.message } },
          400,
        );
      }
      throw err;
    }

    const { order, items: createdItems } = result;

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

    // Broadcast new order to branch and kitchen
    const orderPayload = {
      type: "order:new",
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        status: order.status,
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
    await wsManager.publish(`branch:${tenant.branchId}`, orderPayload);
    await wsManager.publish(`branch:${tenant.branchId}:kitchen`, orderPayload);

    return c.json({ success: true, data: { ...order, items: createdItems } }, 201);
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
  requirePermission("orders:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateOrderStatusSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

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

    // Atomic transition: only update if the status is still what we read.
    // If a concurrent request already moved it, no row comes back -> 409.
    const [updated] = await db
      .update(schema.orders)
      .set({ status, updated_at: new Date() })
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.branch_id, tenant.branchId),
          eq(schema.orders.organization_id, tenant.organizationId),
          eq(schema.orders.status, order.status),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        {
          success: false,
          error: { code: "CONFLICT", message: "La orden fue modificada por otra operación. Intenta de nuevo." },
        },
        409,
      );
    }

    const updatePayload = {
      type: "order:updated",
      payload: { orderId: updated.id, orderNumber: updated.order_number, status: updated.status },
      timestamp: Date.now(),
    };
    await wsManager.publish(`branch:${tenant.branchId}`, updatePayload);
    await wsManager.publish(`branch:${tenant.branchId}:kitchen`, updatePayload);

    // If order has a session, notify the customer too
    if (order.table_session_id) {
      await wsManager.publish(`session:${order.table_session_id}`, updatePayload);
    }

    // Handle side effects when order is completed (loyalty points + inventory deduction)
    if (status === "completed") {
      await handleOrderCompletion({
        orderId: order.id,
        orderNumber: order.order_number,
        orderSubtotal: order.subtotal,
        orderDiscount: order.discount,
        customerId: order.customer_id,
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
  requirePermission("orders:update"),
  zValidator("param", z.object({ id: z.string().uuid(), itemId: z.string().uuid() })),
  zValidator("json", updateOrderItemStatusSchema),
  async (c) => {
    const { id, itemId } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Verify order belongs to branch
    const [order] = await db
      .select({
        id: schema.orders.id,
        order_number: schema.orders.order_number,
        table_session_id: schema.orders.table_session_id,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.branch_id, tenant.branchId),
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

    const [updated] = await db
      .update(schema.orderItems)
      .set({ status })
      .where(eq(schema.orderItems.id, itemId))
      .returning();

    const itemPayload = {
      type: "order:item_status",
      payload: {
        orderId: id,
        orderNumber: order.order_number,
        item: { id: updated.id, name: updated.name, quantity: updated.quantity, status: updated.status },
      },
      timestamp: Date.now(),
    };
    await wsManager.publish(`branch:${tenant.branchId}`, itemPayload);
    await wsManager.publish(`branch:${tenant.branchId}:kitchen`, itemPayload);
    if (order.table_session_id) {
      await wsManager.publish(`session:${order.table_session_id}`, itemPayload);
    }

    return c.json({ success: true, data: updated });
  },
);

// POST /:id/void - Reverse loyalty points awarded for a COMPLETED order.
// This is the post-completion clawback: when an order is voided/refunded after
// completion, the points it earned must be removed. Idempotent (voidOrderPoints
// no-ops if already reversed). Requires an elevated permission.
orders.post(
  "/:id/void",
  requirePermission("orders:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Ensure the order exists, belongs to this tenant, and is completed.
    const [order] = await db
      .select({
        id: schema.orders.id,
        status: schema.orders.status,
        order_number: schema.orders.order_number,
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

    return c.json({ success: true, data: result });
  },
);

export { orders };
