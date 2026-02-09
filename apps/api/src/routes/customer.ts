import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, inArray, sql, desc, isNull } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  startSessionSchema,
  createOrderSchema,
  idParamSchema,
} from "@restai/validators";
import { z } from "zod";
import { signCustomerToken, verifyAccessToken } from "../lib/jwt.js";
import { wsManager } from "../ws/manager.js";
import { findOrCreate } from "../services/customer.service.js";
import { createOrder, OrderValidationError } from "../services/order.service.js";
import { redeemReward } from "../services/loyalty.service.js";
import * as sessionService from "../services/session.service.js";

const customer = new Hono<AppEnv>();

// GET /:branchSlug/:tableCode/menu - Get menu for branch (public)
customer.get("/:branchSlug/:tableCode/menu", async (c) => {
  const branchSlug = c.req.param("branchSlug");
  const tableCode = c.req.param("tableCode");

  // Find branch by slug
  const [branch] = await db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.slug, branchSlug))
    .limit(1);

  if (!branch || !branch.is_active) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
      404,
    );
  }

  // Verify table exists
  const [table] = await db
    .select()
    .from(schema.tables)
    .where(
      and(
        eq(schema.tables.qr_code, tableCode),
        eq(schema.tables.branch_id, branch.id),
      ),
    )
    .limit(1);

  if (!table) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
      404,
    );
  }

  // Get active categories and items
  const categories = await db
    .select()
    .from(schema.menuCategories)
    .where(
      and(
        eq(schema.menuCategories.branch_id, branch.id),
        eq(schema.menuCategories.is_active, true),
      ),
    );

  const items = await db
    .select()
    .from(schema.menuItems)
    .where(
      and(
        eq(schema.menuItems.branch_id, branch.id),
        eq(schema.menuItems.is_available, true),
      ),
    );

  return c.json({
    success: true,
    data: {
      branch: { id: branch.id, name: branch.name, slug: branch.slug, currency: branch.currency },
      table: { id: table.id, number: table.number },
      categories,
      items,
    },
  });
});

// POST /:branchSlug/:tableCode/register - Register customer + create session (public)
customer.post(
  "/:branchSlug/:tableCode/register",
  zValidator("json", z.object({
    customerName: z.string().min(1).max(255),
    customerPhone: z.string().optional(),
    email: z.string().email().optional(),
    birthDate: z.string().optional(),
  })),
  async (c) => {
    const branchSlug = c.req.param("branchSlug");
    const tableCode = c.req.param("tableCode");
    const body = c.req.valid("json");

    // Find branch
    const [branch] = await db.select().from(schema.branches).where(eq(schema.branches.slug, branchSlug)).limit(1);
    if (!branch) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } }, 404);

    // Find table
    const [table] = await db.select().from(schema.tables).where(and(eq(schema.tables.qr_code, tableCode), eq(schema.tables.branch_id, branch.id))).limit(1);
    if (!table) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } }, 404);

    // Check if table already has an active session - return existing token
    const [activeSession] = await db
      .select()
      .from(schema.tableSessions)
      .where(and(eq(schema.tableSessions.table_id, table.id), eq(schema.tableSessions.status, "active")))
      .limit(1);

    if (activeSession) {
      return c.json({
        success: true,
        data: {
          session: activeSession,
          token: activeSession.token,
          sessionId: activeSession.id,
          existing: true,
        },
      });
    }

    // Check if table has a pending session
    const [pendingSession] = await db
      .select()
      .from(schema.tableSessions)
      .where(and(eq(schema.tableSessions.table_id, table.id), eq(schema.tableSessions.status, "pending")))
      .limit(1);

    if (pendingSession) {
      return c.json(
        { success: false, error: { code: "SESSION_PENDING", message: "Esta mesa esta en espera de aprobacion" } },
        409,
      );
    }

    // Find existing customer or create new one (dedup by email/phone)
    const { customer: customer_record } = await findOrCreate({
      organizationId: branch.organization_id,
      name: body.customerName,
      email: body.email,
      phone: body.customerPhone,
      birthDate: body.birthDate,
    });

    // Create session with pending status
    const sessionId = crypto.randomUUID();
    const token = await signCustomerToken({ sub: sessionId, org: branch.organization_id, branch: branch.id, table: table.id, customerId: customer_record.id });

    const session = await sessionService.createSession({
      tableId: table.id,
      branchId: branch.id,
      organizationId: branch.organization_id,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      token,
      status: "pending",
    });

    await wsManager.publish(`branch:${branch.id}`, {
      type: "session:pending",
      payload: { sessionId: session.id, tableId: table.id, tableNumber: table.number, customerName: body.customerName },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: { session, token, sessionId: session.id, customer: customer_record } }, 201);
  },
);

// GET /:branchSlug/:tableCode/check-session - Check if table has active/pending session (public)
customer.get("/:branchSlug/:tableCode/check-session", async (c) => {
  const branchSlug = c.req.param("branchSlug");
  const tableCode = c.req.param("tableCode");

  const [branch] = await db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.slug, branchSlug))
    .limit(1);

  if (!branch) {
    return c.json({ success: true, data: { hasSession: false } });
  }

  const [table] = await db
    .select()
    .from(schema.tables)
    .where(and(eq(schema.tables.qr_code, tableCode), eq(schema.tables.branch_id, branch.id)))
    .limit(1);

  if (!table) {
    return c.json({ success: true, data: { hasSession: false } });
  }

  // Check for active session
  const [activeSession] = await db
    .select({
      id: schema.tableSessions.id,
      status: schema.tableSessions.status,
      customer_name: schema.tableSessions.customer_name,
    })
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.table_id, table.id),
        eq(schema.tableSessions.status, "active"),
      ),
    )
    .limit(1);

  if (activeSession) {
    return c.json({
      success: true,
      data: {
        hasSession: true,
        status: "active",
        sessionId: activeSession.id,
        customerName: activeSession.customer_name,
      },
    });
  }

  // Check for pending session
  const [pendingSession] = await db
    .select({
      id: schema.tableSessions.id,
      status: schema.tableSessions.status,
      customer_name: schema.tableSessions.customer_name,
    })
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.table_id, table.id),
        eq(schema.tableSessions.status, "pending"),
      ),
    )
    .limit(1);

  if (pendingSession) {
    return c.json({
      success: true,
      data: {
        hasSession: true,
        status: "pending",
        sessionId: pendingSession.id,
        customerName: pendingSession.customer_name,
      },
    });
  }

  return c.json({ success: true, data: { hasSession: false } });
});

// POST /:branchSlug/:tableCode/session - Start session (public)
customer.post(
  "/:branchSlug/:tableCode/session",
  zValidator("json", startSessionSchema),
  async (c) => {
    const branchSlug = c.req.param("branchSlug");
    const tableCode = c.req.param("tableCode");
    const body = c.req.valid("json");

    // Find branch
    const [branch] = await db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.slug, branchSlug))
      .limit(1);

    if (!branch) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
        404,
      );
    }

    // Find table
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.qr_code, tableCode),
          eq(schema.tables.branch_id, branch.id),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Check if table already has an active session - return existing token
    const [activeSession] = await db
      .select()
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, table.id),
          eq(schema.tableSessions.status, "active"),
        ),
      )
      .limit(1);

    if (activeSession) {
      return c.json({
        success: true,
        data: {
          session: activeSession,
          token: activeSession.token,
          sessionId: activeSession.id,
          existing: true,
        },
      });
    }

    // Check if table has a pending session
    const [pendingSession] = await db
      .select()
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, table.id),
          eq(schema.tableSessions.status, "pending"),
        ),
      )
      .limit(1);

    if (pendingSession) {
      return c.json(
        {
          success: false,
          error: {
            code: "SESSION_PENDING",
            message: "Esta mesa esta en espera de aprobacion",
          },
        },
        409,
      );
    }

    // Link to existing customer if phone is provided (enables points accumulation)
    let customerId: string | undefined;
    if (body.customerPhone) {
      const { customer: found } = await findOrCreate({
        organizationId: branch.organization_id,
        name: body.customerName,
        phone: body.customerPhone,
      });
      customerId = found.id;
    }

    // Generate customer token
    const sessionId = crypto.randomUUID();
    const token = await signCustomerToken({
      sub: sessionId,
      org: branch.organization_id,
      branch: branch.id,
      table: table.id,
      ...(customerId ? { customerId } : {}),
    });

    // Create session with pending status
    const session = await sessionService.createSession({
      tableId: table.id,
      branchId: branch.id,
      organizationId: branch.organization_id,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      token,
      status: "pending",
    });

    // Broadcast pending session for staff approval
    await wsManager.publish(`branch:${branch.id}`, {
      type: "session:pending",
      payload: { sessionId: session.id, tableId: table.id, tableNumber: table.number, customerName: body.customerName },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: { session, token, sessionId: session.id } }, 201);
  },
);

// GET /:branchSlug/:tableCode/session-status/:sessionId - Poll session status (public)
customer.get("/:branchSlug/:tableCode/session-status/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  const [session] = await db
    .select({
      id: schema.tableSessions.id,
      status: schema.tableSessions.status,
      customer_name: schema.tableSessions.customer_name,
    })
    .from(schema.tableSessions)
    .where(eq(schema.tableSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sesion no encontrada" } },
      404,
    );
  }

  return c.json({ success: true, data: session });
});

// GET /:branchSlug/menu/items/:itemId/modifiers - Get modifier groups for item (public)
customer.get("/:branchSlug/menu/items/:itemId/modifiers", async (c) => {
  const branchSlug = c.req.param("branchSlug");
  const itemId = c.req.param("itemId");

  // Verify branch exists
  const [branch] = await db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(eq(schema.branches.slug, branchSlug))
    .limit(1);

  if (!branch) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
      404,
    );
  }

  // Get linked modifier groups for this item
  const links = await db
    .select()
    .from(schema.menuItemModifierGroups)
    .where(eq(schema.menuItemModifierGroups.item_id, itemId));

  if (links.length === 0) {
    return c.json({ success: true, data: [] });
  }

  const groupIds = links.map((l) => l.group_id);
  const groups = await db
    .select()
    .from(schema.modifierGroups)
    .where(
      groupIds.length === 1
        ? eq(schema.modifierGroups.id, groupIds[0])
        : inArray(schema.modifierGroups.id, groupIds),
    );

  const allModifiers = await db
    .select()
    .from(schema.modifiers)
    .where(
      groupIds.length === 1
        ? eq(schema.modifiers.group_id, groupIds[0])
        : inArray(schema.modifiers.group_id, groupIds),
    );

  const result = groups.map((g) => ({
    ...g,
    modifiers: allModifiers.filter((m) => m.group_id === g.id && m.is_available),
  }));

  return c.json({ success: true, data: result });
});

// Customer auth middleware for order routes
const customerAuth = async (c: any, next: any) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Token requerido" } },
      401,
    );
  }

  try {
    const payload = await verifyAccessToken(header.slice(7));
    if ((payload as any).role !== "customer") {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Solo clientes" } },
        403,
      );
    }
    c.set("user", payload);
    return next();
  } catch {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Token inválido" } },
      401,
    );
  }
};

// Middleware to validate that the customer's session is still active
const requireActiveSession = async (c: any, next: any) => {
  const user = c.get("user") as any;
  const tableId = user.table;

  const [session] = await db
    .select({
      id: schema.tableSessions.id,
      status: schema.tableSessions.status,
      customer_name: schema.tableSessions.customer_name,
    })
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.table_id, tableId),
        eq(schema.tableSessions.status, "active"),
      ),
    )
    .limit(1);

  if (!session) {
    return c.json(
      { success: false, error: { code: "SESSION_ENDED", message: "Tu sesión ha finalizado" } },
      403,
    );
  }

  c.set("session", session);
  return next();
};

// GET /my-loyalty - Get loyalty info for current customer (customer auth)
customer.get("/my-loyalty", customerAuth, requireActiveSession, async (c) => {
  const user = c.get("user") as any;
  const customerId = user.customerId;
  const orgId = user.org;

  if (!customerId) {
    return c.json({ success: true, data: null });
  }

  // Get enrollment with program and tier info
  const enrollment = await db
    .select({
      id: schema.customerLoyalty.id,
      points_balance: schema.customerLoyalty.points_balance,
      total_points_earned: schema.customerLoyalty.total_points_earned,
      program_name: schema.loyaltyPrograms.name,
      program_id: schema.loyaltyPrograms.id,
      tier_name: schema.loyaltyTiers.name,
      tier_min_points: schema.loyaltyTiers.min_points,
    })
    .from(schema.customerLoyalty)
    .innerJoin(
      schema.loyaltyPrograms,
      and(
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
        eq(schema.loyaltyPrograms.organization_id, orgId),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .leftJoin(
      schema.loyaltyTiers,
      eq(schema.customerLoyalty.tier_id, schema.loyaltyTiers.id),
    )
    .where(eq(schema.customerLoyalty.customer_id, customerId))
    .limit(1);

  if (enrollment.length === 0) {
    return c.json({ success: true, data: null });
  }

  const info = enrollment[0];

  // Get available rewards for this program
  const availableRewards = await db
    .select({
      id: schema.rewards.id,
      name: schema.rewards.name,
      description: schema.rewards.description,
      points_cost: schema.rewards.points_cost,
      discount_type: schema.rewards.discount_type,
      discount_value: schema.rewards.discount_value,
    })
    .from(schema.rewards)
    .where(
      and(
        eq(schema.rewards.program_id, info.program_id),
        eq(schema.rewards.is_active, true),
      ),
    );

  // Get next tier (if any)
  const nextTier = await db
    .select({
      name: schema.loyaltyTiers.name,
      min_points: schema.loyaltyTiers.min_points,
    })
    .from(schema.loyaltyTiers)
    .where(
      and(
        eq(schema.loyaltyTiers.program_id, info.program_id),
        sql`${schema.loyaltyTiers.min_points} > ${info.total_points_earned}`,
      ),
    )
    .orderBy(schema.loyaltyTiers.min_points)
    .limit(1);

  return c.json({
    success: true,
    data: {
      points_balance: info.points_balance,
      total_points_earned: info.total_points_earned,
      program_name: info.program_name,
      tier_name: info.tier_name,
      next_tier: nextTier[0] || null,
      rewards: availableRewards,
    },
  });
});

// GET /my-coupons - Get available coupons for current customer (customer auth)
customer.get("/my-coupons", customerAuth, requireActiveSession, async (c) => {
  const user = c.get("user") as any;
  const customerId = user.customerId;

  if (!customerId) {
    return c.json({ success: true, data: [] });
  }

  // Get coupons assigned to this customer that are still active
  const assigned = await db
    .select({
      id: schema.coupons.id,
      code: schema.coupons.code,
      name: schema.coupons.name,
      description: schema.coupons.description,
      type: schema.coupons.type,
      discount_value: schema.coupons.discount_value,
      min_order_amount: schema.coupons.min_order_amount,
      max_discount_amount: schema.coupons.max_discount_amount,
      expires_at: schema.coupons.expires_at,
      menu_item_id: schema.coupons.menu_item_id,
    })
    .from(schema.couponAssignments)
    .innerJoin(
      schema.coupons,
      eq(schema.couponAssignments.coupon_id, schema.coupons.id),
    )
    .where(
      and(
        eq(schema.couponAssignments.customer_id, customerId),
        eq(schema.coupons.status, "active"),
        sql`(${schema.coupons.expires_at} IS NULL OR ${schema.coupons.expires_at} > NOW())`,
        sql`(${schema.coupons.max_uses_total} IS NULL OR ${schema.coupons.current_uses} < ${schema.coupons.max_uses_total})`,
      ),
    );

  // Mark as seen
  if (assigned.length > 0) {
    const couponIds = assigned.map((a) => a.id);
    await db
      .update(schema.couponAssignments)
      .set({ seen_at: new Date() })
      .where(
        and(
          eq(schema.couponAssignments.customer_id, customerId),
          inArray(schema.couponAssignments.coupon_id, couponIds),
        ),
      );
  }

  return c.json({ success: true, data: assigned });
});

// POST /orders - Create order (customer auth)
customer.post("/orders", customerAuth, requireActiveSession, zValidator("json", createOrderSchema), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user") as any;
  const session = c.get("session") as any;

  const branchId = user.branch;
  const organizationId = user.org;

  // Use customer_name from session if not provided in body
  const customerName = body.customerName || session.customer_name;

  let result;
  try {
    result = await createOrder({
      organizationId,
      branchId,
      items: body.items,
      type: body.type,
      customerName,
      notes: body.notes,
      tableSessionId: session.id,
      customerId: user.customerId || null,
      couponCode: body.couponCode || null,
      redemptionId: body.redemptionId || null,
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

  // Broadcast
  await wsManager.publish(`branch:${branchId}`, {
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
      })),
    },
    timestamp: Date.now(),
  });

  return c.json({ success: true, data: { ...order, items: createdItems } }, 201);
});

// GET /orders/:id - Get order status (customer auth)
customer.get("/orders/:id", customerAuth, zValidator("param", idParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  const user = c.get("user") as any;

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.id, id),
        eq(schema.orders.branch_id, user.branch),
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
});

// POST /validate-coupon - Validate coupon code (customer auth)
customer.post(
  "/validate-coupon",
  customerAuth,
  requireActiveSession,
  zValidator("json", z.object({ code: z.string().min(1) })),
  async (c) => {
    const user = c.get("user") as any;
    const { code } = c.req.valid("json");

    const [coupon] = await db
      .select()
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.organization_id, user.org),
          eq(schema.coupons.code, code.toUpperCase()),
        ),
      )
      .limit(1);

    if (!coupon) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cupon no encontrado" } },
        404,
      );
    }

    if (coupon.status !== "active") {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon no esta activo" } },
        400,
      );
    }

    const now = new Date();
    if (coupon.starts_at && now < coupon.starts_at) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon aun no esta vigente" } },
        400,
      );
    }
    if (coupon.expires_at && now > coupon.expires_at) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon ha expirado" } },
        400,
      );
    }
    if (coupon.max_uses_total && coupon.current_uses >= coupon.max_uses_total) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon ha alcanzado el limite de usos" } },
        400,
      );
    }

    return c.json({
      success: true,
      data: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        type: coupon.type,
        discount_value: coupon.discount_value,
        min_order_amount: coupon.min_order_amount,
        max_discount_amount: coupon.max_discount_amount,
        menu_item_id: coupon.menu_item_id,
      },
    });
  },
);

// POST /orders/:id/cancel - Cancel order before kitchen starts (customer auth)
customer.post(
  "/orders/:id/cancel",
  customerAuth,
  requireActiveSession,
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const user = c.get("user") as any;
    const branchId = user.branch;

    // Verify order belongs to customer's branch
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.branch_id, branchId),
        ),
      )
      .limit(1);

    if (!order) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
        404,
      );
    }

    // Get all items for this order
    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.order_id, id));

    // Check ALL items are still pending
    const nonPendingItem = items.find((item) => item.status !== "pending");
    if (nonPendingItem) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El pedido ya está siendo preparado" } },
        409,
      );
    }

    // Update order status to cancelled
    await db
      .update(schema.orders)
      .set({ status: "cancelled" })
      .where(eq(schema.orders.id, id));

    // Update all order items to cancelled
    if (items.length > 0) {
      await db
        .update(schema.orderItems)
        .set({ status: "cancelled" })
        .where(eq(schema.orderItems.order_id, id));
    }

    // Revert coupon if order had one
    const [redemption] = await db
      .select()
      .from(schema.couponRedemptions)
      .where(eq(schema.couponRedemptions.order_id, id))
      .limit(1);

    if (redemption) {
      // Decrement current_uses
      await db
        .update(schema.coupons)
        .set({ current_uses: sql`GREATEST(${schema.coupons.current_uses} - 1, 0)` })
        .where(eq(schema.coupons.id, redemption.coupon_id));

      // Delete redemption record
      await db
        .delete(schema.couponRedemptions)
        .where(eq(schema.couponRedemptions.id, redemption.id));

      // Clear used_at on assignment if customer is known
      if (order.customer_id) {
        await db
          .update(schema.couponAssignments)
          .set({ used_at: null })
          .where(
            and(
              eq(schema.couponAssignments.coupon_id, redemption.coupon_id),
              eq(schema.couponAssignments.customer_id, order.customer_id),
            ),
          );
      }
    }

    // Revert reward redemption if order had one
    const [rewardRedemption] = await db
      .select({
        id: schema.rewardRedemptions.id,
        customer_loyalty_id: schema.rewardRedemptions.customer_loyalty_id,
        reward_id: schema.rewardRedemptions.reward_id,
      })
      .from(schema.rewardRedemptions)
      .where(eq(schema.rewardRedemptions.order_id, id))
      .limit(1);

    if (rewardRedemption) {
      const [reward] = await db
        .select({ points_cost: schema.rewards.points_cost, name: schema.rewards.name })
        .from(schema.rewards)
        .where(eq(schema.rewards.id, rewardRedemption.reward_id))
        .limit(1);

      if (reward) {
        // Refund points
        await db
          .update(schema.customerLoyalty)
          .set({
            points_balance: sql`${schema.customerLoyalty.points_balance} + ${reward.points_cost}`,
          })
          .where(eq(schema.customerLoyalty.id, rewardRedemption.customer_loyalty_id));

        // Record refund transaction
        await db.insert(schema.loyaltyTransactions).values({
          customer_loyalty_id: rewardRedemption.customer_loyalty_id,
          order_id: id,
          points: reward.points_cost,
          type: "adjusted",
          description: `Reembolso por cancelación: ${reward.name}`,
        });
      }

      // Unlink redemption from order so it can be reused
      await db
        .update(schema.rewardRedemptions)
        .set({ order_id: null })
        .where(eq(schema.rewardRedemptions.id, rewardRedemption.id));
    }

    // Broadcast cancellation
    await wsManager.publish(`branch:${branchId}`, {
      type: "order:cancelled",
      payload: {
        orderId: id,
        orderNumber: order.order_number,
      },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: { message: "Pedido cancelado exitosamente" } });
  },
);

// POST /table-action - Request bill or call waiter (customer auth)
customer.post(
  "/table-action",
  customerAuth,
  requireActiveSession,
  zValidator(
    "json",
    z.object({
      action: z.enum(["request_bill", "call_waiter"]),
      tableSessionId: z.string().min(1),
    }),
  ),
  async (c) => {
    const user = c.get("user") as any;
    const { action, tableSessionId } = c.req.valid("json");
    const branchId = user.branch;
    const tableId = user.table;

    // Get table number for the notification
    const [table] = await db
      .select({ number: schema.tables.number })
      .from(schema.tables)
      .where(eq(schema.tables.id, tableId))
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    const eventType = action === "request_bill" ? "table:request_bill" : "table:call_waiter";
    const message = action === "request_bill" ? "La cuenta ha sido solicitada" : "El mozo ha sido llamado";

    await wsManager.publish(`branch:${branchId}`, {
      type: eventType,
      payload: {
        tableSessionId,
        tableId,
        tableNumber: table.number,
        action,
      },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: { message } });
  },
);

// POST /redeem-reward - Self-service reward redemption (customer auth)
customer.post(
  "/redeem-reward",
  customerAuth,
  requireActiveSession,
  zValidator("json", z.object({ rewardId: z.string().uuid() })),
  async (c) => {
    const user = c.get("user") as any;
    const customerId = user.customerId;

    if (!customerId) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "No tienes cuenta de fidelidad" } },
        400,
      );
    }

    // Find customer loyalty enrollment
    const [enrollment] = await db
      .select({ id: schema.customerLoyalty.id })
      .from(schema.customerLoyalty)
      .where(eq(schema.customerLoyalty.customer_id, customerId))
      .limit(1);

    if (!enrollment) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "No estas inscrito en el programa de fidelidad" } },
        400,
      );
    }

    const { rewardId } = c.req.valid("json");

    try {
      const result = await redeemReward({
        rewardId,
        customerLoyaltyId: enrollment.id,
        organizationId: user.org,
      });
      return c.json({ success: true, data: result }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "REWARD_NOT_FOUND") {
        return c.json({ success: false, error: { code: "NOT_FOUND", message: "Recompensa no encontrada" } }, 404);
      }
      if (message === "INSUFFICIENT_POINTS") {
        return c.json({ success: false, error: { code: "BAD_REQUEST", message: "Puntos insuficientes" } }, 400);
      }
      if (message === "PROGRAM_MISMATCH") {
        return c.json({ success: false, error: { code: "BAD_REQUEST", message: "La recompensa no pertenece a tu programa" } }, 400);
      }
      throw err;
    }
  },
);

// GET /my-orders - Orders for the current session (customer auth)
customer.get("/my-orders", customerAuth, requireActiveSession, async (c) => {
  const session = c.get("session") as any;

  const orders = await db
    .select({
      id: schema.orders.id,
      order_number: schema.orders.order_number,
      status: schema.orders.status,
      total: schema.orders.total,
      created_at: schema.orders.created_at,
    })
    .from(schema.orders)
    .where(eq(schema.orders.table_session_id, session.id))
    .orderBy(desc(schema.orders.created_at));

  if (orders.length === 0) {
    return c.json({ success: true, data: [] });
  }

  const orderIds = orders.map((o) => o.id);
  const allItems = await db
    .select({
      id: schema.orderItems.id,
      name: schema.orderItems.name,
      quantity: schema.orderItems.quantity,
      status: schema.orderItems.status,
      order_id: schema.orderItems.order_id,
    })
    .from(schema.orderItems)
    .where(
      orderIds.length === 1
        ? eq(schema.orderItems.order_id, orderIds[0])
        : inArray(schema.orderItems.order_id, orderIds),
    );

  const data = orders.map((o) => ({
    ...o,
    items: allItems.filter((i) => i.order_id === o.id),
  }));

  return c.json({ success: true, data });
});

// GET /my-redemptions - Pending redemptions not yet applied to an order (customer auth)
customer.get("/my-redemptions", customerAuth, requireActiveSession, async (c) => {
  const user = c.get("user") as any;
  const customerId = user.customerId;

  if (!customerId) {
    return c.json({ success: true, data: [] });
  }

  // Find customer loyalty enrollment
  const [enrollment] = await db
    .select({ id: schema.customerLoyalty.id })
    .from(schema.customerLoyalty)
    .where(eq(schema.customerLoyalty.customer_id, customerId))
    .limit(1);

  if (!enrollment) {
    return c.json({ success: true, data: [] });
  }

  const redemptions = await db
    .select({
      id: schema.rewardRedemptions.id,
      reward_name: schema.rewards.name,
      discount_type: schema.rewards.discount_type,
      discount_value: schema.rewards.discount_value,
      redeemed_at: schema.rewardRedemptions.redeemed_at,
    })
    .from(schema.rewardRedemptions)
    .innerJoin(schema.rewards, eq(schema.rewardRedemptions.reward_id, schema.rewards.id))
    .where(
      and(
        eq(schema.rewardRedemptions.customer_loyalty_id, enrollment.id),
        isNull(schema.rewardRedemptions.order_id),
      ),
    );

  return c.json({ success: true, data: redemptions });
});

export { customer };
