import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, inArray, gte, sql } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createOrderSchema,
  updateOrderStatusSchema,
  updateOrderItemStatusSchema,
  idParamSchema,
} from "@restai/validators";
import { ORDER_STATUS_TRANSITIONS, ORDER_ITEM_STATUS_TRANSITIONS } from "@restai/config";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { generateOrderNumber } from "../lib/id.js";
import { wsManager } from "../ws/manager.js";
import { z } from "zod";

const orders = new Hono<AppEnv>();

orders.use("*", authMiddleware);
orders.use("*", tenantMiddleware);
orders.use("*", requireBranch);

// GET / - List orders
orders.get("/", requirePermission("orders:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const status = c.req.query("status");

  const conditions = [
    eq(schema.orders.branch_id, tenant.branchId),
    eq(schema.orders.organization_id, tenant.organizationId),
  ];

  if (status) {
    conditions.push(eq(schema.orders.status, status as any));
  }

  const result = await db
    .select()
    .from(schema.orders)
    .where(and(...conditions))
    .orderBy(desc(schema.orders.created_at))
    .limit(50);

  return c.json({ success: true, data: result });
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

    // Get menu items for price calculation
    const menuItemIds = body.items.map((i) => i.menuItemId);
    const menuItemsResult = await db
      .select()
      .from(schema.menuItems)
      .where(inArray(schema.menuItems.id, menuItemIds));

    const menuItemMap = new Map(menuItemsResult.map((mi) => [mi.id, mi]));

    // Calculate totals
    let subtotal = 0;
    const orderItemsData: Array<{
      menu_item_id: string;
      name: string;
      unit_price: number;
      quantity: number;
      total: number;
      notes?: string;
    }> = [];

    for (const item of body.items) {
      const menuItem = menuItemMap.get(item.menuItemId);
      if (!menuItem) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: `Item no encontrado: ${item.menuItemId}` } },
          400,
        );
      }
      if (!menuItem.is_available) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: `Item no disponible: ${menuItem.name}` } },
          400,
        );
      }

      const itemTotal = menuItem.price * item.quantity;
      subtotal += itemTotal;

      orderItemsData.push({
        menu_item_id: menuItem.id,
        name: menuItem.name,
        unit_price: menuItem.price,
        quantity: item.quantity,
        total: itemTotal,
        notes: item.notes,
      });
    }

    // Get branch tax rate
    const [branch] = await db
      .select({ tax_rate: schema.branches.tax_rate })
      .from(schema.branches)
      .where(eq(schema.branches.id, tenant.branchId))
      .limit(1);

    const taxRate = branch?.tax_rate || 1800;
    const tax = Math.round(subtotal * taxRate / 10000);
    const total = subtotal + tax;

    const orderNumber = generateOrderNumber();

    // Determine table_session_id for customer
    let tableSessionId: string | null = null;
    if (user.role === "customer") {
      // Find active session for this table
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

    // Create order
    const [order] = await db
      .insert(schema.orders)
      .values({
        organization_id: tenant.organizationId,
        branch_id: tenant.branchId,
        table_session_id: tableSessionId,
        order_number: orderNumber,
        type: body.type,
        status: "pending",
        customer_name: body.customerName,
        subtotal,
        tax,
        total,
        notes: body.notes,
      })
      .returning();

    // Create order items
    const createdItems = await db
      .insert(schema.orderItems)
      .values(
        orderItemsData.map((item) => ({
          order_id: order.id,
          ...item,
        })),
      )
      .returning();

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

    const [updated] = await db
      .update(schema.orders)
      .set({ status, updated_at: new Date() })
      .where(eq(schema.orders.id, id))
      .returning();

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

    // Award loyalty points when order is completed
    if (status === "completed" && order.customer_id) {
      try {
        // Find customer's loyalty enrollment with program info
        const [enrollment] = await db
          .select({
            id: schema.customerLoyalty.id,
            points_balance: schema.customerLoyalty.points_balance,
            total_points_earned: schema.customerLoyalty.total_points_earned,
            tier_id: schema.customerLoyalty.tier_id,
            program_id: schema.customerLoyalty.program_id,
            points_per_currency_unit: schema.loyaltyPrograms.points_per_currency_unit,
          })
          .from(schema.customerLoyalty)
          .innerJoin(
            schema.loyaltyPrograms,
            and(
              eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
              eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
              eq(schema.loyaltyPrograms.is_active, true),
            ),
          )
          .where(eq(schema.customerLoyalty.customer_id, order.customer_id))
          .limit(1);

        if (enrollment) {
          // Calculate points: total is in cents, divide by 100 for soles, multiply by rate
          const pointsEarned = Math.floor(order.total / 100) * enrollment.points_per_currency_unit;

          if (pointsEarned > 0) {
            const newBalance = enrollment.points_balance + pointsEarned;
            const newTotal = enrollment.total_points_earned + pointsEarned;

            // Update points
            await db
              .update(schema.customerLoyalty)
              .set({
                points_balance: newBalance,
                total_points_earned: newTotal,
              })
              .where(eq(schema.customerLoyalty.id, enrollment.id));

            // Log transaction
            await db.insert(schema.loyaltyTransactions).values({
              customer_loyalty_id: enrollment.id,
              order_id: order.id,
              points: pointsEarned,
              type: "earned",
              description: `Orden #${order.order_number} completada`,
            });

            // Check tier upgrade: find the highest tier the customer qualifies for
            const [nextTier] = await db
              .select()
              .from(schema.loyaltyTiers)
              .where(
                and(
                  eq(schema.loyaltyTiers.program_id, enrollment.program_id),
                  gte(sql`${newTotal}`, schema.loyaltyTiers.min_points),
                ),
              )
              .orderBy(desc(schema.loyaltyTiers.min_points))
              .limit(1);

            if (nextTier && nextTier.id !== enrollment.tier_id) {
              await db
                .update(schema.customerLoyalty)
                .set({ tier_id: nextTier.id })
                .where(eq(schema.customerLoyalty.id, enrollment.id));
            }
          }
        }
      } catch (_loyaltyErr) {
        // Loyalty point errors should not break order completion
        console.error("Error awarding loyalty points:", _loyaltyErr);
      }
    }

    // Auto-deduct inventory when order is completed
    if (status === "completed") {
      try {
        const orderItemsList = await db
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.order_id, id));

        for (const orderItem of orderItemsList) {
          const recipeIngredients = await db
            .select()
            .from(schema.recipeIngredients)
            .where(eq(schema.recipeIngredients.menu_item_id, orderItem.menu_item_id));

          for (const ingredient of recipeIngredients) {
            const deductQty = parseFloat(ingredient.quantity_used) * orderItem.quantity;

            // Deduct from inventory stock
            await db
              .update(schema.inventoryItems)
              .set({
                current_stock: sql`(${schema.inventoryItems.current_stock}::numeric - ${deductQty})::text`,
              })
              .where(eq(schema.inventoryItems.id, ingredient.inventory_item_id));

            // Record consumption movement
            await db
              .insert(schema.inventoryMovements)
              .values({
                item_id: ingredient.inventory_item_id,
                type: "consumption",
                quantity: String(deductQty),
                reference: updated.order_number,
                notes: `Auto-consumo: ${orderItem.name} x${orderItem.quantity}`,
              });
          }
        }
      } catch (_inventoryErr) {
        // Inventory errors should not fail order completion
        console.error("Inventory deduction error:", _inventoryErr);
      }
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
      .select({ id: schema.orders.id, order_number: schema.orders.order_number })
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

    return c.json({ success: true, data: updated });
  },
);

export { orders };
