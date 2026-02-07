import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  startSessionSchema,
  createOrderSchema,
  idParamSchema,
} from "@restai/validators";
import { z } from "zod";
import { signCustomerToken, verifyAccessToken } from "../lib/jwt.js";
import { wsManager } from "../ws/manager.js";
import { createCustomer } from "../services/customer.service.js";
import { createOrder, OrderValidationError } from "../services/order.service.js";
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

    // Create customer + auto-enroll in loyalty
    const { customer: customer_record } = await createCustomer({
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
      token: schema.tableSessions.token,
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
        token: activeSession.token,
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

    // Generate customer token
    const sessionId = crypto.randomUUID();
    const token = await signCustomerToken({
      sub: sessionId,
      org: branch.organization_id,
      branch: branch.id,
      table: table.id,
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
      },
    });
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

export { customer };
