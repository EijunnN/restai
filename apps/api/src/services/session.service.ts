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
  /**
   * Optional explicit row id. The customer JWT is signed with `sub = <this id>`
   * BEFORE the row exists (the token is then stored on the row), so the caller
   * must pin the row id to that same value. Otherwise the DB defaultRandom() id
   * diverges from token.sub and every requireActiveSession lookup
   * (tableSessions.id == token.sub) fails with SESSION_ENDED.
   */
  id?: string;
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
      ...(params.id ? { id: params.id } : {}),
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
  const now = new Date();

  // Update session + table status in a single transaction using a
  // compare-and-swap so concurrent approvals can't both succeed.
  const result = await db.transaction(async (tx) => {
    // Compare-and-swap: only a still-pending, not-yet-expired session in this
    // branch flips to active. Folding the expiry check into the WHERE keeps the
    // transition atomic — no read-then-write race window.
    const [updated] = await tx
      .update(schema.tableSessions)
      .set({ status: "active", expires_at: addHours(now, ACTIVE_TTL_HOURS) })
      .where(
        and(
          eq(schema.tableSessions.id, params.sessionId),
          eq(schema.tableSessions.branch_id, params.branchId),
          eq(schema.tableSessions.status, "pending"),
          gte(schema.tableSessions.expires_at, now),
        ),
      )
      .returning();

    if (!updated) return null;

    await tx
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, updated.table_id));

    return { session: updated, tableId: updated.table_id };
  });

  if (result) return result;

  // Approval failed. Distinguish "expired" from "not found / not pending" and
  // auto-reject a pending-but-expired session so the table is freed up. This
  // runs OUTSIDE the approval transaction on purpose: throwing inside the tx
  // would roll the rejection back, leaving the dead session stuck as pending.
  const [expired] = await db
    .update(schema.tableSessions)
    .set({ status: "rejected", ended_at: now })
    .where(
      and(
        eq(schema.tableSessions.id, params.sessionId),
        eq(schema.tableSessions.branch_id, params.branchId),
        eq(schema.tableSessions.status, "pending"),
        lt(schema.tableSessions.expires_at, now),
      ),
    )
    .returning();

  if (expired) {
    throw new Error("SESSION_EXPIRED");
  }
  throw new Error("PENDING_SESSION_NOT_FOUND");
}

// ── Reject Session ──────────────────────────────────────────────────

export async function rejectSession(params: {
  sessionId: string;
  branchId: string;
}) {
  // Compare-and-swap: only a still-pending session in this branch flips to
  // rejected, so concurrent reject/approve can't both win.
  const [updated] = await db
    .update(schema.tableSessions)
    .set({ status: "rejected" })
    .where(
      and(
        eq(schema.tableSessions.id, params.sessionId),
        eq(schema.tableSessions.branch_id, params.branchId),
        eq(schema.tableSessions.status, "pending"),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("PENDING_SESSION_NOT_FOUND");
  }

  return { session: updated, tableId: updated.table_id };
}

// ── End Session ─────────────────────────────────────────────────────

export async function endSession(params: {
  sessionId: string;
  branchId: string;
}) {
  // Do the open-orders guard + state change + table reset in one transaction
  // with a compare-and-swap so concurrent ends can't both succeed.
  return await db.transaction(async (tx) => {
    // Check for open orders (not completed/cancelled) before transitioning.
    const [openOrder] = await tx
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

    // Compare-and-swap: only a still-active session in this branch completes.
    const [updated] = await tx
      .update(schema.tableSessions)
      .set({ status: "completed", ended_at: new Date() })
      .where(
        and(
          eq(schema.tableSessions.id, params.sessionId),
          eq(schema.tableSessions.branch_id, params.branchId),
          eq(schema.tableSessions.status, "active"),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("ACTIVE_SESSION_NOT_FOUND");
    }

    await tx
      .update(schema.tables)
      .set({ status: "available" })
      .where(eq(schema.tables.id, updated.table_id));

    return { session: updated, tableId: updated.table_id };
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

  return await db.transaction(async (tx) => {
    // Expire pending sessions (already set-based).
    const expiredPending = await tx
      .update(schema.tableSessions)
      .set({ status: "rejected", ended_at: now })
      .where(
        and(
          eq(schema.tableSessions.status, "pending"),
          lt(schema.tableSessions.expires_at, now),
        ),
      )
      .returning({ table_id: schema.tableSessions.table_id });

    // Expire active sessions (safety net) — skip sessions with open orders.
    // Single set-based UPDATE with a correlated NOT EXISTS anti-join against
    // open orders, replacing the previous per-session N+1 query loop.
    const expiredActive = await tx
      .update(schema.tableSessions)
      .set({ status: "completed", ended_at: now })
      .where(
        and(
          eq(schema.tableSessions.status, "active"),
          lt(schema.tableSessions.expires_at, now),
          sql`NOT EXISTS (
            SELECT 1 FROM ${schema.orders}
            WHERE ${schema.orders.table_session_id} = ${schema.tableSessions.id}
              AND ${schema.orders.status} NOT IN ('completed', 'cancelled')
          )`,
        ),
      )
      .returning({ table_id: schema.tableSessions.table_id });

    // Reset associated tables to available in the same transaction.
    const tableIds = [
      ...expiredPending.map((r) => r.table_id),
      ...expiredActive.map((r) => r.table_id),
    ];

    if (tableIds.length > 0) {
      const uniqueTableIds = [...new Set(tableIds)];
      await tx
        .update(schema.tables)
        .set({ status: "available" })
        .where(inArray(schema.tables.id, uniqueTableIds));

      logger.info("Expired stale sessions", {
        pending: expiredPending.length,
        active: expiredActive.length,
      });
    }

    return expiredPending.length + expiredActive.length;
  });
}
