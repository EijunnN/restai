import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";

// ── Create Session ──────────────────────────────────────────────────

export async function createSession(params: {
  tableId: string;
  branchId: string;
  organizationId: string;
  customerName: string;
  customerPhone?: string;
  token: string;
  status?: "active" | "pending";
}) {
  const [session] = await db
    .insert(schema.tableSessions)
    .values({
      table_id: params.tableId,
      branch_id: params.branchId,
      organization_id: params.organizationId,
      customer_name: params.customerName,
      customer_phone: params.customerPhone,
      token: params.token,
      status: params.status ?? "pending",
    })
    .returning();

  return session;
}

// ── Approve Session ─────────────────────────────────────────────────

export async function approveSession(params: {
  sessionId: string;
  branchId: string;
}) {
  // Find pending session
  const [session] = await db
    .select()
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.id, params.sessionId),
        eq(schema.tableSessions.branch_id, params.branchId),
        eq(schema.tableSessions.status, "pending"),
      ),
    )
    .limit(1);

  if (!session) {
    throw new Error("PENDING_SESSION_NOT_FOUND");
  }

  // Update session + table status in a transaction
  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.tableSessions)
      .set({ status: "active" })
      .where(eq(schema.tableSessions.id, params.sessionId))
      .returning();

    await tx
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, session.table_id));

    return { session: updated, tableId: session.table_id };
  });
}

// ── Reject Session ──────────────────────────────────────────────────

export async function rejectSession(params: {
  sessionId: string;
  branchId: string;
}) {
  // Find pending session
  const [session] = await db
    .select()
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.id, params.sessionId),
        eq(schema.tableSessions.branch_id, params.branchId),
        eq(schema.tableSessions.status, "pending"),
      ),
    )
    .limit(1);

  if (!session) {
    throw new Error("PENDING_SESSION_NOT_FOUND");
  }

  const [updated] = await db
    .update(schema.tableSessions)
    .set({ status: "rejected" })
    .where(eq(schema.tableSessions.id, params.sessionId))
    .returning();

  return { session: updated, tableId: session.table_id };
}

// ── End Session ─────────────────────────────────────────────────────

export async function endSession(params: {
  sessionId: string;
  branchId: string;
}) {
  // Find active session
  const [session] = await db
    .select()
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.id, params.sessionId),
        eq(schema.tableSessions.branch_id, params.branchId),
        eq(schema.tableSessions.status, "active"),
      ),
    )
    .limit(1);

  if (!session) {
    throw new Error("ACTIVE_SESSION_NOT_FOUND");
  }

  // Update session + table status in a transaction
  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.tableSessions)
      .set({ status: "completed", ended_at: new Date() })
      .where(eq(schema.tableSessions.id, params.sessionId))
      .returning();

    await tx
      .update(schema.tables)
      .set({ status: "available" })
      .where(eq(schema.tables.id, session.table_id));

    return { session: updated, tableId: session.table_id };
  });
}

// ── Get Table History ───────────────────────────────────────────────

export async function getTableHistory(params: {
  tableId: string;
  branchId: string;
  from?: string;
  to?: string;
}) {
  // Verify table belongs to this branch
  const [table] = await db
    .select()
    .from(schema.tables)
    .where(
      and(
        eq(schema.tables.id, params.tableId),
        eq(schema.tables.branch_id, params.branchId),
      ),
    )
    .limit(1);

  if (!table) {
    throw new Error("TABLE_NOT_FOUND");
  }

  // Build session query conditions
  const sessionConditions = [
    eq(schema.tableSessions.table_id, params.tableId),
    eq(schema.tableSessions.branch_id, params.branchId),
  ];

  if (params.from) {
    sessionConditions.push(gte(schema.tableSessions.started_at, new Date(params.from)));
  }
  if (params.to) {
    const toDate = new Date(params.to);
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
          eq(schema.orders.branch_id, params.branchId),
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

  // Build result with orders
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

  return {
    sessions: sessionsWithOrders,
    summary: {
      total_revenue: totalRevenue,
      total_orders: totalOrders,
      total_sessions: sessions.length,
      avg_duration_minutes: avgDuration,
    },
  };
}
