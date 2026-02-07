import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, isNull, desc, gte, lte, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createTableSchema,
  updateTableStatusSchema,
  startSessionSchema,
  idParamSchema,
} from "@restai/validators";
import { z } from "zod";
import { TABLE_STATUS_TRANSITIONS } from "@restai/config";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { generateQrCode } from "../lib/id.js";
import { signCustomerToken } from "../lib/jwt.js";
import { wsManager } from "../ws/manager.js";

const tables = new Hono<AppEnv>();

tables.use("*", authMiddleware);
tables.use("*", tenantMiddleware);
tables.use("*", requireBranch);

// GET / - List tables for branch (optional spaceId filter)
tables.get("/", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const spaceId = c.req.query("spaceId");

  const conditions = [
    eq(schema.tables.branch_id, tenant.branchId),
    eq(schema.tables.organization_id, tenant.organizationId),
  ];

  if (spaceId === "none") {
    conditions.push(isNull(schema.tables.space_id));
  } else if (spaceId) {
    conditions.push(eq(schema.tables.space_id, spaceId));
  }

  const result = await db
    .select()
    .from(schema.tables)
    .where(and(...conditions));

  const [branch] = await db
    .select({ slug: schema.branches.slug })
    .from(schema.branches)
    .where(eq(schema.branches.id, tenant.branchId))
    .limit(1);

  return c.json({ success: true, data: { tables: result, branchSlug: branch?.slug || "" } });
});

// POST / - Create table
tables.post(
  "/",
  requirePermission("tables:create"),
  zValidator("json", createTableSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Get branch slug for QR code
    const [branch] = await db
      .select({ slug: schema.branches.slug })
      .from(schema.branches)
      .where(eq(schema.branches.id, tenant.branchId))
      .limit(1);

    const qrCode = generateQrCode(branch?.slug || "branch", body.number);

    const [table] = await db
      .insert(schema.tables)
      .values({
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        space_id: body.spaceId || null,
        number: body.number,
        capacity: body.capacity,
        qr_code: qrCode,
      })
      .returning();

    return c.json({ success: true, data: table }, 201);
  },
);

// PATCH /:id - Update table
tables.patch(
  "/:id",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", z.object({
    capacity: z.number().int().min(1).max(50).optional(),
    spaceId: z.string().uuid().nullable().optional(),
  })),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.capacity !== undefined) updateData.capacity = body.capacity;
    if (body.spaceId !== undefined) updateData.space_id = body.spaceId;

    const [updated] = await db
      .update(schema.tables)
      .set(updateData)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// PATCH /:id/position - Update table position
tables.patch(
  "/:id/position",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", z.object({ x: z.number(), y: z.number() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { x, y } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [updated] = await db
      .update(schema.tables)
      .set({ position_x: x, position_y: y })
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /:id - Delete table
tables.delete(
  "/:id",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [deleted] = await db
      .delete(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: deleted });
  },
);

// PATCH /:id/status - Update table status
tables.patch(
  "/:id/status",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateTableStatusSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Get current table
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Validate status transition
    const allowed = TABLE_STATUS_TRANSITIONS[table.status];
    if (!allowed?.includes(status)) {
      return c.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: `No se puede cambiar de "${table.status}" a "${status}"`,
          },
        },
        400,
      );
    }

    const [updated] = await db
      .update(schema.tables)
      .set({ status })
      .where(eq(schema.tables.id, id))
      .returning();

    // Broadcast table status change
    await wsManager.publish(`branch:${tenant.branchId}`, {
      type: "table:status",
      payload: { tableId: updated.id, number: updated.number, status: updated.status },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: updated });
  },
);

// POST /sessions - Start a table session (customer QR flow)
tables.post(
  "/sessions",
  zValidator(
    "json",
    startSessionSchema.extend({ tableId: z.string().uuid() }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Get table
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, body.tableId),
          eq(schema.tables.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Generate customer token
    const customerToken = await signCustomerToken({
      sub: crypto.randomUUID(),
      org: tenant.organizationId,
      branch: tenant.branchId,
      table: table.id,
    });

    // Create session
    const [session] = await db
      .insert(schema.tableSessions)
      .values({
        table_id: table.id,
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        customer_name: body.customerName,
        customer_phone: body.customerPhone,
        token: customerToken,
      })
      .returning();

    // Set table to occupied
    await db
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, table.id));

    // Broadcast
    await wsManager.publish(`branch:${tenant.branchId}`, {
      type: "session:started",
      payload: { sessionId: session.id, tableNumber: table.number, customerName: body.customerName },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: { session, token: customerToken } }, 201);
  },
);

// GET /sessions - List sessions with optional status filter
tables.get("/sessions", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const statusParam = c.req.query("status");

  const conditions = [
    eq(schema.tableSessions.branch_id, tenant.branchId),
    eq(schema.tableSessions.organization_id, tenant.organizationId),
  ];

  if (statusParam) {
    conditions.push(eq(schema.tableSessions.status, statusParam as any));
  }

  const sessions = await db
    .select({
      id: schema.tableSessions.id,
      table_id: schema.tableSessions.table_id,
      customer_name: schema.tableSessions.customer_name,
      customer_phone: schema.tableSessions.customer_phone,
      status: schema.tableSessions.status,
      started_at: schema.tableSessions.started_at,
      ended_at: schema.tableSessions.ended_at,
    })
    .from(schema.tableSessions)
    .where(and(...conditions))
    .orderBy(desc(schema.tableSessions.started_at))
    .limit(50);

  // Join with tables to get table numbers
  const tablesData = await db
    .select({ id: schema.tables.id, number: schema.tables.number })
    .from(schema.tables)
    .where(eq(schema.tables.branch_id, tenant.branchId));

  const tableMap = new Map(tablesData.map(t => [t.id, t.number]));

  const result = sessions.map(s => ({
    ...s,
    table_number: tableMap.get(s.table_id) ?? 0,
  }));

  return c.json({ success: true, data: result });
});

// GET /sessions/pending - List pending sessions for branch
tables.get("/sessions/pending", async (c) => {
  const tenant = c.get("tenant") as any;

  const sessions = await db
    .select({
      id: schema.tableSessions.id,
      customer_name: schema.tableSessions.customer_name,
      customer_phone: schema.tableSessions.customer_phone,
      started_at: schema.tableSessions.started_at,
      table_id: schema.tableSessions.table_id,
      table_number: schema.tables.number,
    })
    .from(schema.tableSessions)
    .innerJoin(schema.tables, eq(schema.tableSessions.table_id, schema.tables.id))
    .where(
      and(
        eq(schema.tableSessions.branch_id, tenant.branchId),
        eq(schema.tableSessions.status, "pending"),
      ),
    );

  return c.json({ success: true, data: sessions });
});

// GET /sessions/:id
tables.get(
  "/sessions/:id",
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [session] = await db
      .select()
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!session) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sesión no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: session });
  },
);

// PATCH /sessions/:id/approve - Approve pending session
tables.patch(
  "/sessions/:id/approve",
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [session] = await db
      .select()
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.status, "pending"),
        ),
      )
      .limit(1);

    if (!session) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sesion pendiente no encontrada" } },
        404,
      );
    }

    // Approve session
    const [updated] = await db
      .update(schema.tableSessions)
      .set({ status: "active" })
      .where(eq(schema.tableSessions.id, id))
      .returning();

    // Set table to occupied
    await db
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, session.table_id));

    // Broadcast approval
    await wsManager.publish(`branch:${tenant.branchId}`, {
      type: "session:approved",
      payload: { sessionId: id, tableId: session.table_id },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: updated });
  },
);

// PATCH /sessions/:id/reject - Reject pending session
tables.patch(
  "/sessions/:id/reject",
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [session] = await db
      .select()
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.status, "pending"),
        ),
      )
      .limit(1);

    if (!session) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sesion pendiente no encontrada" } },
        404,
      );
    }

    const [updated] = await db
      .update(schema.tableSessions)
      .set({ status: "rejected" })
      .where(eq(schema.tableSessions.id, id))
      .returning();

    // Broadcast rejection
    await wsManager.publish(`branch:${tenant.branchId}`, {
      type: "session:rejected",
      payload: { sessionId: id, tableId: session.table_id },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: updated });
  },
);

// PATCH /sessions/:id/end - End an active session
tables.patch(
  "/sessions/:id/end",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Find the session - must be active
    const [session] = await db
      .select()
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.status, "active"),
        ),
      )
      .limit(1);

    if (!session) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sesion activa no encontrada" } },
        404,
      );
    }

    // Set session to completed with ended_at timestamp
    const [updated] = await db
      .update(schema.tableSessions)
      .set({ status: "completed", ended_at: new Date() })
      .where(eq(schema.tableSessions.id, id))
      .returning();

    // Set table back to available
    await db
      .update(schema.tables)
      .set({ status: "available" })
      .where(eq(schema.tables.id, session.table_id));

    // Broadcast session ended
    await wsManager.publish(`branch:${tenant.branchId}`, {
      type: "session:ended",
      payload: { sessionId: id, tableId: session.table_id },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: updated });
  },
);

// GET /:id/history - Table history with sessions and orders
tables.get(
  "/:id/history",
  requirePermission("tables:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;
    const from = c.req.query("from");
    const to = c.req.query("to");

    // Verify table belongs to this branch
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Build session query conditions
    const sessionConditions = [
      eq(schema.tableSessions.table_id, id),
      eq(schema.tableSessions.branch_id, tenant.branchId),
    ];

    if (from) {
      sessionConditions.push(gte(schema.tableSessions.started_at, new Date(from)));
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      sessionConditions.push(lte(schema.tableSessions.started_at, toDate));
    }

    const sessions = await db
      .select()
      .from(schema.tableSessions)
      .where(and(...sessionConditions))
      .orderBy(desc(schema.tableSessions.started_at))
      .limit(100);

    // Get orders for each session
    const sessionIds = sessions.map((s) => s.id);
    let sessionOrders: any[] = [];
    if (sessionIds.length > 0) {
      sessionOrders = await db
        .select({
          id: schema.orders.id,
          table_session_id: schema.orders.table_session_id,
          order_number: schema.orders.order_number,
          total: schema.orders.total,
          status: schema.orders.status,
          created_at: schema.orders.created_at,
        })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.branch_id, tenant.branchId),
            inArray(schema.orders.table_session_id, sessionIds),
          ),
        );
    }

    // Group orders by session
    const ordersBySession = new Map<string, any[]>();
    for (const order of sessionOrders) {
      const key = order.table_session_id;
      if (!ordersBySession.has(key)) ordersBySession.set(key, []);
      ordersBySession.get(key)!.push(order);
    }

    // Build result
    const sessionsWithOrders = sessions.map((s) => {
      const orders = ordersBySession.get(s.id) || [];
      const totalRevenue = orders.reduce((sum: number, o: any) => sum + o.total, 0);
      const duration = s.ended_at
        ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)
        : null;
      return {
        ...s,
        orders,
        total_revenue: totalRevenue,
        order_count: orders.length,
        duration_minutes: duration,
      };
    });

    // Summary
    const totalRevenue = sessionsWithOrders.reduce((sum, s) => sum + s.total_revenue, 0);
    const totalOrders = sessionsWithOrders.reduce((sum, s) => sum + s.order_count, 0);
    const completedSessions = sessionsWithOrders.filter((s) => s.duration_minutes !== null);
    const avgDuration = completedSessions.length > 0
      ? Math.round(completedSessions.reduce((sum, s) => sum + s.duration_minutes!, 0) / completedSessions.length)
      : 0;

    return c.json({
      success: true,
      data: {
        sessions: sessionsWithOrders,
        summary: {
          total_revenue: totalRevenue,
          total_orders: totalOrders,
          total_sessions: sessions.length,
          avg_duration_minutes: avgDuration,
        },
      },
    });
  },
);

// GET /my-assignments - List tables assigned to the current user
tables.get("/my-assignments", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const user = c.get("user") as any;

  const assignments = await db
    .select({
      table_id: schema.tableAssignments.table_id,
      table_number: schema.tables.number,
    })
    .from(schema.tableAssignments)
    .innerJoin(schema.tables, eq(schema.tableAssignments.table_id, schema.tables.id))
    .where(
      and(
        eq(schema.tableAssignments.user_id, user.sub),
        eq(schema.tableAssignments.branch_id, tenant.branchId),
      ),
    );

  return c.json({ success: true, data: assignments });
});

// GET /:id/assignments - List assigned waiters for a table
tables.get(
  "/:id/assignments",
  requirePermission("tables:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const assignments = await db
      .select({
        id: schema.tableAssignments.id,
        table_id: schema.tableAssignments.table_id,
        user_id: schema.tableAssignments.user_id,
        created_at: schema.tableAssignments.created_at,
        user_name: schema.users.name,
        user_role: schema.users.role,
      })
      .from(schema.tableAssignments)
      .innerJoin(schema.users, eq(schema.tableAssignments.user_id, schema.users.id))
      .where(
        and(
          eq(schema.tableAssignments.table_id, id),
          eq(schema.tableAssignments.branch_id, tenant.branchId),
        ),
      );

    return c.json({ success: true, data: assignments });
  },
);

// POST /:id/assignments - Assign waiter to table
tables.post(
  "/:id/assignments",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", z.object({ userId: z.string().uuid() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Check table exists
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Check if already assigned
    const [existing] = await db
      .select()
      .from(schema.tableAssignments)
      .where(
        and(
          eq(schema.tableAssignments.table_id, id),
          eq(schema.tableAssignments.user_id, userId),
        ),
      )
      .limit(1);

    if (existing) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El usuario ya esta asignado a esta mesa" } },
        409,
      );
    }

    const [assignment] = await db
      .insert(schema.tableAssignments)
      .values({
        table_id: id,
        user_id: userId,
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
      })
      .returning();

    return c.json({ success: true, data: assignment }, 201);
  },
);

// DELETE /:id/assignments/:userId - Remove assignment
tables.delete(
  "/:id/assignments/:userId",
  requirePermission("tables:update"),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.req.param("userId");
    const tenant = c.get("tenant") as any;

    const [deleted] = await db
      .delete(schema.tableAssignments)
      .where(
        and(
          eq(schema.tableAssignments.table_id, id),
          eq(schema.tableAssignments.user_id, userId),
          eq(schema.tableAssignments.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Asignacion no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: deleted });
  },
);

export { tables };
