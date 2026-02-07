import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { updateOrderItemStatusSchema, idParamSchema, kitchenQuerySchema } from "@restai/validators";
import { ORDER_ITEM_STATUS_TRANSITIONS } from "@restai/config";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { wsManager } from "../ws/manager.js";

const kitchen = new Hono<AppEnv>();

kitchen.use("*", authMiddleware);
kitchen.use("*", tenantMiddleware);
kitchen.use("*", requireBranch);

// GET /orders - Get active orders for branch kitchen display
kitchen.get("/orders", requirePermission("orders:read"), zValidator("query", kitchenQuerySchema), async (c) => {
  const tenant = c.get("tenant") as any;
  const { status } = c.req.valid("query");

  const statusList = status ? [status] : ["pending", "confirmed", "preparing", "ready"];

  const activeOrders = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.branch_id, tenant.branchId),
        inArray(schema.orders.status, statusList as any),
      ),
    );

  // Get items for each order
  const ordersWithItems = await Promise.all(
    activeOrders.map(async (order) => {
      const items = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.order_id, order.id));
      return { ...order, items };
    }),
  );

  return c.json({ success: true, data: ordersWithItems });
});

// PATCH /items/:id/status - Update kitchen item status
kitchen.patch(
  "/items/:id/status",
  requirePermission("orders:update_item_status"),
  zValidator("param", idParamSchema),
  zValidator("json", updateOrderItemStatusSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Get item with order info
    const [item] = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, id))
      .limit(1);

    if (!item) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    // Verify order belongs to branch
    const [order] = await db
      .select({ id: schema.orders.id, branch_id: schema.orders.branch_id, order_number: schema.orders.order_number })
      .from(schema.orders)
      .where(eq(schema.orders.id, item.order_id))
      .limit(1);

    if (!order || order.branch_id !== tenant.branchId) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
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
      .where(eq(schema.orderItems.id, id))
      .returning();

    const itemPayload = {
      type: "order:item_status",
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        item: { id: updated.id, name: updated.name, quantity: updated.quantity, status: updated.status },
      },
      timestamp: Date.now(),
    };
    await wsManager.publish(`branch:${tenant.branchId}`, itemPayload);
    await wsManager.publish(`branch:${tenant.branchId}:kitchen`, itemPayload);

    return c.json({ success: true, data: updated });
  },
);

export { kitchen };
