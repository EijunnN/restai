import { eq, and, desc, gte, lte, lt, inArray, notInArray, sql, not } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { logger } from "../lib/logger.js";

// TTL constants
export const PENDING_TTL_MINUTES = 10;
export const ACTIVE_TTL_HOURS = 8;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

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
  const now = new Date();
  const status = params.status ?? "pending";
  const expires_at = status === "pending"
    ? addMinutes(now, PENDING_TTL_MINUTES)
    : addHours(now, ACTIVE_TTL_HOURS);

  const [session] = await db
    .insert(schema.tableSessions)
    .values({
      table_id: params.tableId,
      branch_id: params.branchId,
      organization_id: params.organizationId,
      customer_name: params.customerName,
      customer_phone: params.customerPhone,
      token: params.token,
      status,
      expires_at,
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

  // Check if session has expired
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    // Auto-reject expired session
    await db
      .update(schema.tableSessions)
      .set({ status: "rejected", ended_at: new Date() })
      .where(eq(schema.tableSessions.id, params.sessionId));
    throw new Error("SESSION_EXPIRED");
  }

  // Update session + table status in a transaction
  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.tableSessions)
      .set({ status: "active", expires_at: addHours(new Date(), ACTIVE_TTL_HOURS) })
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

  // Check for open orders (not completed/cancelled)
  const [openOrder] = await db
    .select({ id: schema.orders.id, status: schema.orders.status })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.table_session_id, params.sessionId),
        notInArray(schema.orders.status, ["completed", "cancelled"]),
      ),
    )
    .limit(1);

  if (openOrder) {
    throw new Error("SESSION_HAS_OPEN_ORDERS");
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

// ── Expire Stale Sessions ───────────────────────────────────────────

/**
 * Auto-expires pending and active sessions that have passed their TTL.
 * Resets associated tables to "available".
 * Returns the number of expired sessions.
 */
export async function expireStale(): Promise<number> {
  const now = new Date();

  // Expire pending sessions
  const expiredPending = await db
    .update(schema.tableSessions)
    .set({ status: "rejected", ended_at: now })
    .where(
      and(
        eq(schema.tableSessions.status, "pending"),
        lt(schema.tableSessions.expires_at, now),
      ),
    )
    .returning({ table_id: schema.tableSessions.table_id });

  // Expire active sessions (safety net) — skip sessions with open orders
  // First find expired active sessions, then filter out those with open orders
  const expiredActiveCandidates = await db
    .select({ id: schema.tableSessions.id, table_id: schema.tableSessions.table_id })
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.status, "active"),
        lt(schema.tableSessions.expires_at, now),
      ),
    );

  const safeToExpire: string[] = [];
  const expiredActiveTableIds: string[] = [];

  for (const candidate of expiredActiveCandidates) {
    const [openOrder] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.table_session_id, candidate.id),
          notInArray(schema.orders.status, ["completed", "cancelled"]),
        ),
      )
      .limit(1);

    if (!openOrder) {
      safeToExpire.push(candidate.id);
      expiredActiveTableIds.push(candidate.table_id);
    }
  }

  let expiredActiveCount = 0;
  if (safeToExpire.length > 0) {
    await db
      .update(schema.tableSessions)
      .set({ status: "completed", ended_at: now })
      .where(inArray(schema.tableSessions.id, safeToExpire));
    expiredActiveCount = safeToExpire.length;
  }

  // Reset tables to available
  const tableIds = [
    ...expiredPending.map((r) => r.table_id),
    ...expiredActiveTableIds,
  ];

  if (tableIds.length > 0) {
    const uniqueTableIds = [...new Set(tableIds)];
    await db
      .update(schema.tables)
      .set({ status: "available" })
      .where(inArray(schema.tables.id, uniqueTableIds));

    logger.info("Expired stale sessions", {
      pending: expiredPending.length,
      active: expiredActiveCount,
    });
  }

  return expiredPending.length + expiredActiveCount;
}
