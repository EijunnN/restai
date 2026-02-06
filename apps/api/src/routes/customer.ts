import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  startSessionSchema,
  createOrderSchema,
  idParamSchema,
} from "@restai/validators";
import { z } from "zod";
import { signCustomerToken, verifyAccessToken } from "../lib/jwt.js";
import { generateOrderNumber } from "../lib/id.js";
import { wsManager } from "../ws/manager.js";
import { inArray } from "drizzle-orm";

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

    // Create customer
    const [customer_record] = await db.insert(schema.customers).values({
      organization_id: branch.organization_id,
      name: body.customerName,
      email: body.email,
      phone: body.customerPhone,
      birth_date: body.birthDate,
    }).returning();

    // Auto-enroll in loyalty program if one exists
    const [program] = await db.select().from(schema.loyaltyPrograms).where(and(eq(schema.loyaltyPrograms.organization_id, branch.organization_id), eq(schema.loyaltyPrograms.is_active, true))).limit(1);

    if (program) {
      const [lowestTier] = await db.select().from(schema.loyaltyTiers).where(eq(schema.loyaltyTiers.program_id, program.id)).orderBy(schema.loyaltyTiers.min_points).limit(1);

      await db.insert(schema.customerLoyalty).values({
        customer_id: customer_record.id,
        program_id: program.id,
        tier_id: lowestTier?.id || null,
      });
    }

    // Create session with pending status
    const sessionId = crypto.randomUUID();
    const token = await signCustomerToken({ sub: sessionId, org: branch.organization_id, branch: branch.id, table: table.id, customerId: customer_record.id });

    const [session] = await db.insert(schema.tableSessions).values({
      table_id: table.id,
      branch_id: branch.id,
      organization_id: branch.organization_id,
      customer_name: body.customerName,
      customer_phone: body.customerPhone,
      token,
      status: "pending",
    }).returning();

    await wsManager.publish(`branch:${branch.id}`, {
      type: "session:pending",
      payload: { sessionId: session.id, tableNumber: table.number, customerName: body.customerName },
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
    const [session] = await db
      .insert(schema.tableSessions)
      .values({
        table_id: table.id,
        branch_id: branch.id,
        organization_id: branch.organization_id,
        customer_name: body.customerName,
        customer_phone: body.customerPhone,
        token,
        status: "pending",
      })
      .returning();

    // Broadcast pending session for staff approval
    await wsManager.publish(`branch:${branch.id}`, {
      type: "session:pending",
      payload: { sessionId: session.id, tableNumber: table.number, customerName: body.customerName },
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

// POST /orders - Create order (customer auth)
customer.post("/orders", customerAuth, zValidator("json", createOrderSchema), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user") as any;

  const branchId = user.branch;
  const organizationId = user.org;
  const tableId = user.table;

  // Get menu items
  const menuItemIds = body.items.map((i) => i.menuItemId);
  const menuItemsResult = await db
    .select()
    .from(schema.menuItems)
    .where(inArray(schema.menuItems.id, menuItemIds));

  const menuItemMap = new Map(menuItemsResult.map((mi) => [mi.id, mi]));

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
    if (!menuItem || !menuItem.is_available) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: `Item no disponible: ${item.menuItemId}` } },
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

  // Get tax rate
  const [branch] = await db
    .select({ tax_rate: schema.branches.tax_rate })
    .from(schema.branches)
    .where(eq(schema.branches.id, branchId))
    .limit(1);

  const taxRate = branch?.tax_rate || 1800;
  const tax = Math.round(subtotal * taxRate / 10000);
  const total = subtotal + tax;

  // Find active session
  const [session] = await db
    .select({ id: schema.tableSessions.id })
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.table_id, tableId),
        eq(schema.tableSessions.status, "active"),
      ),
    )
    .limit(1);

  const orderNumber = generateOrderNumber();

  const [order] = await db
    .insert(schema.orders)
    .values({
      organization_id: organizationId,
      branch_id: branchId,
      table_session_id: session?.id || null,
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

  const createdItems = await db
    .insert(schema.orderItems)
    .values(orderItemsData.map((item) => ({ order_id: order.id, ...item })))
    .returning();

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

export { customer };
