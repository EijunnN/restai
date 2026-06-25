import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, isNull, desc, inArray, notInArray, sql } from "drizzle-orm";
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
import { realtime } from "../infrastructure/container.js";
import * as sessionService from "../services/session.service.js";
import { handleOrderCompletion } from "../services/order.service.js";

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

    // Verify space belongs to this tenant/branch when provided
    if (body.spaceId) {
      const [space] = await db
        .select({ id: schema.spaces.id })
        .from(schema.spaces)
        .where(
          and(
            eq(schema.spaces.id, body.spaceId),
            eq(schema.spaces.branch_id, tenant.branchId),
            eq(schema.spaces.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      if (!space) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "Espacio no encontrado" } },
          400,
        );
      }
    }

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

    // Verify space belongs to this tenant/branch when provided (non-null)
    if (body.spaceId) {
      const [space] = await db
        .select({ id: schema.spaces.id })
        .from(schema.spaces)
        .where(
          and(
            eq(schema.spaces.id, body.spaceId),
            eq(schema.spaces.branch_id, tenant.branchId),
            eq(schema.spaces.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      if (!space) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "Espacio no encontrado" } },
          400,
        );
      }
    }

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
          eq(schema.tables.organization_id, tenant.organizationId),
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
          eq(schema.tables.organization_id, tenant.organizationId),
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

    // Verify the table belongs to this tenant/branch before any destructive action
    const [table] = await db
      .select({ id: schema.tables.id })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // tableSessions.table_id is onDelete:'cascade', so a hard delete would erase
    // session + order history. Block deletion if there is any non-completed activity.
    const [activeSession] = await db
      .select({ id: schema.tableSessions.id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.organization_id, tenant.organizationId),
          inArray(schema.tableSessions.status, ["pending", "active"]),
        ),
      )
      .limit(1);

    if (activeSession) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar la mesa: tiene una sesion activa o pendiente",
          },
        },
        409,
      );
    }

    const [openOrder] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .innerJoin(
        schema.tableSessions,
        eq(schema.orders.table_session_id, schema.tableSessions.id),
      )
      .where(
        and(
          eq(schema.tableSessions.table_id, id),
          eq(schema.orders.branch_id, tenant.branchId),
          eq(schema.orders.organization_id, tenant.organizationId),
          notInArray(schema.orders.status, ["completed", "cancelled"]),
        ),
      )
      .limit(1);

    if (openOrder) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar la mesa: tiene pedidos sin completar",
          },
        },
        409,
      );
    }

    // Any existing session/order history (completed/cancelled) blocks hard deletion
    // to avoid cascade-erasing the audit trail. There is no soft-delete column on
    // tables, so we refuse to destroy history.
    const [historySession] = await db
      .select({ id: schema.tableSessions.id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (historySession) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar la mesa: tiene historial de sesiones",
          },
        },
        409,
      );
    }

    const [deleted] = await db
      .delete(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
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
          eq(schema.tables.organization_id, tenant.organizationId),
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

    // Atomic transition: only update if the status is still what we validated against
    const [updated] = await db
      .update(schema.tables)
      .set({ status })
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
          eq(schema.tables.status, table.status),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "El estado de la mesa cambio, intenta de nuevo",
          },
        },
        409,
      );
    }

    // Broadcast table status change
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "table:status",
      payload: { tableId: updated.id, number: updated.number, status: updated.status },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: updated });
  },
);

// POST /sessions - Staff walk-in seating (creates an active session directly)
tables.post(
  "/sessions",
  requirePermission("tables:update"),
  zValidator(
    "json",
    startSessionSchema.extend({ tableId: z.string().uuid() }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Get table (scoped to tenant + branch)
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, body.tableId),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Staff can only seat walk-ins on a free table
    if (table.status !== "available" && table.status !== "reserved") {
      return c.json(
        {
          success: false,
          error: { code: "CONFLICT", message: "La mesa no esta disponible" },
        },
        409,
      );
    }

    // Generate customer token
    const customerToken = await signCustomerToken({
      sub: crypto.randomUUID(),
      org: tenant.organizationId,
      branch: tenant.branchId,
      table: table.id,
    });

    // Create the active session and occupy the table atomically. The table flip is
    // conditional on its current status so a concurrent seating yields a 409.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionService.ACTIVE_TTL_HOURS * 3_600_000);

    let session;
    try {
      session = await db.transaction(async (tx) => {
        const [occupied] = await tx
          .update(schema.tables)
          .set({ status: "occupied" })
          .where(
            and(
              eq(schema.tables.id, table.id),
              eq(schema.tables.branch_id, tenant.branchId),
              eq(schema.tables.organization_id, tenant.organizationId),
              eq(schema.tables.status, table.status),
            ),
          )
          .returning();

        if (!occupied) {
          throw new Error("TABLE_STATUS_CONFLICT");
        }

        const [created] = await tx
          .insert(schema.tableSessions)
          .values({
            table_id: table.id,
            branch_id: tenant.branchId,
            organization_id: tenant.organizationId,
            customer_name: body.customerName,
            customer_phone: body.customerPhone,
            token: customerToken,
            status: "active",
            expires_at: expiresAt,
          })
          .returning();

        return created;
      });
    } catch (e: any) {
      if (e.message === "TABLE_STATUS_CONFLICT") {
        return c.json(
          {
            success: false,
            error: { code: "CONFLICT", message: "La mesa no esta disponible" },
          },
          409,
        );
      }
      throw e;
    }

    // Broadcast: session is active and the table is now occupied
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "session:started",
      payload: {
        sessionId: session.id,
        tableId: table.id,
        tableNumber: table.number,
        customerName: body.customerName,
        status: "active",
      },
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
    .where(
      and(
        eq(schema.tables.branch_id, tenant.branchId),
        eq(schema.tables.organization_id, tenant.organizationId),
      ),
    );

  const tableMap = new Map(tablesData.map(t => [t.id, t.number]));

  const result = sessions.map(s => ({
    ...s,
    table_number: tableMap.get(s.table_id) ?? 0,
  }));

  return c.json({ success: true, data: result });
});

// GET /sessions/pending - List pending sessions for branch
tables.get("/sessions/pending", requirePermission("tables:read"), async (c) => {
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
        eq(schema.tableSessions.organization_id, tenant.organizationId),
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
          eq(schema.tableSessions.organization_id, tenant.organizationId),
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
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    try {
      const result = await sessionService.approveSession({
        sessionId: id,
        branchId: tenant.branchId,
      });
      const [table] = await db
        .select({ number: schema.tables.number })
        .from(schema.tables)
        .where(
          and(
            eq(schema.tables.id, result.tableId),
            eq(schema.tables.branch_id, tenant.branchId),
            eq(schema.tables.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      // Broadcast approval
      await realtime.publish(`branch:${tenant.branchId}`, {
        type: "session:approved",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });
      await realtime.publish(`session:${id}`, {
        type: "session:approved",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });

      return c.json({ success: true, data: result.session });
    } catch (e: any) {
      if (e.message === "PENDING_SESSION_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Sesion pendiente no encontrada" } },
          404,
        );
      }
      throw e;
    }
  },
);

// PATCH /sessions/:id/reject - Reject pending session
tables.patch(
  "/sessions/:id/reject",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    try {
      const result = await sessionService.rejectSession({
        sessionId: id,
        branchId: tenant.branchId,
      });
      const [table] = await db
        .select({ number: schema.tables.number })
        .from(schema.tables)
        .where(
          and(
            eq(schema.tables.id, result.tableId),
            eq(schema.tables.branch_id, tenant.branchId),
            eq(schema.tables.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      // Broadcast rejection
      await realtime.publish(`branch:${tenant.branchId}`, {
        type: "session:rejected",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });
      await realtime.publish(`session:${id}`, {
        type: "session:rejected",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });

      return c.json({ success: true, data: result.session });
    } catch (e: any) {
      if (e.message === "PENDING_SESSION_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Sesion pendiente no encontrada" } },
          404,
        );
      }
      throw e;
    }
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

    try {
      const result = await sessionService.endSession({
        sessionId: id,
        branchId: tenant.branchId,
      });
      const [table] = await db
        .select({ number: schema.tables.number })
        .from(schema.tables)
        .where(
          and(
            eq(schema.tables.id, result.tableId),
            eq(schema.tables.branch_id, tenant.branchId),
            eq(schema.tables.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      // Broadcast session ended
      await realtime.publish(`branch:${tenant.branchId}`, {
        type: "session:ended",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });
      await realtime.publish(`session:${id}`, {
        type: "session:ended",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });

      return c.json({ success: true, data: result.session });
    } catch (e: any) {
      if (e.message === "ACTIVE_SESSION_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Sesion activa no encontrada" } },
          404,
        );
      }
      throw e;
    }
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

    try {
      const data = await sessionService.getTableHistory({
        tableId: id,
        branchId: tenant.branchId,
        from: from || undefined,
        to: to || undefined,
      });

      return c.json({ success: true, data });
    } catch (e: any) {
      if (e.message === "TABLE_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
          404,
        );
      }
      throw e;
    }
  },
);

// GET /:id/active-session - Current active/pending session for a table + its
// orders with per-order payment status, for the "cobrar desde mesa" dialog.
tables.get(
  "/:id/active-session",
  requirePermission("tables:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Prefer an active session; fall back to a pending one (no orders yet).
    const [session] = await db
      .select({
        id: schema.tableSessions.id,
        customer_name: schema.tableSessions.customer_name,
        customer_phone: schema.tableSessions.customer_phone,
        status: schema.tableSessions.status,
        started_at: schema.tableSessions.started_at,
      })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.organization_id, tenant.organizationId),
          inArray(schema.tableSessions.status, ["active", "pending"]),
        ),
      )
      .orderBy(desc(schema.tableSessions.started_at))
      .limit(1);

    if (!session) {
      return c.json({
        success: true,
        data: { session: null, orders: [], totals: { total: 0, total_paid: 0, remaining: 0 } },
      });
    }

    const orders = await db
      .select({
        id: schema.orders.id,
        order_number: schema.orders.order_number,
        status: schema.orders.status,
        total: schema.orders.total,
        subtotal: schema.orders.subtotal,
        created_at: schema.orders.created_at,
        total_paid: sql<number>`COALESCE((SELECT SUM(amount)::bigint FROM payments WHERE payments.order_id = ${schema.orders.id} AND payments.status = 'completed'), 0)::int`,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.table_session_id, session.id),
          eq(schema.orders.branch_id, tenant.branchId),
          sql`${schema.orders.status} != 'cancelled'`,
        ),
      )
      .orderBy(desc(schema.orders.created_at));

    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await db
          .select({
            id: schema.orderItems.id,
            order_id: schema.orderItems.order_id,
            name: schema.orderItems.name,
            quantity: schema.orderItems.quantity,
            total: schema.orderItems.total,
            paid_at: schema.orderItems.paid_at,
          })
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.order_id, orderIds))
      : [];

    const ordersWithDetail = orders.map((o) => {
      const remaining = Math.max(0, o.total - o.total_paid);
      const payment_status = o.total_paid <= 0 ? "unpaid" : remaining > 0 ? "partial" : "paid";
      const lineItems = items.filter((i) => i.order_id === o.id);
      // Per-item "share" allocates the order total (incl. IGV/discount) across its
      // lines proportionally, so split-bill selection sums back to the order total.
      const itemsWithShare = lineItems.map((it) => ({
        ...it,
        paid: it.paid_at != null,
        share:
          o.subtotal > 0
            ? Math.round((it.total * o.total) / o.subtotal)
            : lineItems.length > 0
              ? Math.round(o.total / lineItems.length)
              : 0,
      }));
      return {
        ...o,
        remaining,
        payment_status,
        items: itemsWithShare,
      };
    });

    const totals = ordersWithDetail.reduce(
      (acc, o) => ({
        total: acc.total + o.total,
        total_paid: acc.total_paid + o.total_paid,
        remaining: acc.remaining + o.remaining,
      }),
      { total: 0, total_paid: 0, remaining: 0 },
    );

    return c.json({ success: true, data: { session, orders: ordersWithDetail, totals } });
  },
);

// POST /:id/free - Free the table for the next customer (the robust "Liberar").
// Closes any active/pending session (clearing orphans), finalizes open orders,
// and sets the table available. See sessionService.freeTable for the rationale.
tables.post(
  "/:id/free",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [table] = await db
      .select({ id: schema.tables.id, number: schema.tables.number })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    const { completedOrders } = await sessionService.freeTable({
      tableId: id,
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
    });

    // Run completion side effects (loyalty + inventory) outside the tx. Each is
    // idempotent and best-effort, so this never blocks freeing the table.
    for (const order of completedOrders) {
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

    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "table:status",
      payload: { tableId: id, number: table.number, status: "available" },
      timestamp: Date.now(),
    });
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "session:ended",
      payload: { tableId: id, tableNumber: table.number },
      timestamp: Date.now(),
    });

    return c.json({
      success: true,
      data: { tableId: id, completedOrders: completedOrders.length },
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
        eq(schema.tableAssignments.organization_id, tenant.organizationId),
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
          eq(schema.tableAssignments.organization_id, tenant.organizationId),
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
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    const [targetUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(
        schema.userBranches,
        eq(schema.users.id, schema.userBranches.user_id),
      )
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.organization_id, tenant.organizationId),
          eq(schema.userBranches.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!targetUser) {
      return c.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: "El usuario no pertenece a esta organización/sucursal" },
        },
        400,
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
          eq(schema.tableAssignments.branch_id, tenant.branchId),
          eq(schema.tableAssignments.organization_id, tenant.organizationId),
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
          eq(schema.tableAssignments.organization_id, tenant.organizationId),
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
