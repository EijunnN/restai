import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestOrg, createTestBranch, createTestTable, createTestCategory, createTestMenuItem, cleanup } from "../setup";
import { createSession, approveSession, rejectSession, endSession, expireStale } from "../../services/session.service";
import { db, schema } from "@restai/db";
import { eq } from "drizzle-orm";

describe("session.service", () => {
  let orgId: string;
  let branchId: string;
  let tableId: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;
    const table = await createTestTable(branchId, orgId);
    tableId = table.id;
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  it("createSession creates a pending session with expires_at", async () => {
    const session = await createSession({
      tableId,
      branchId,
      organizationId: orgId,
      customerName: "Test",
      token: "tok_test",
      status: "pending",
    });

    expect(session.status).toBe("pending");
    expect(session.expires_at).toBeTruthy();
    expect(new Date(session.expires_at!).getTime()).toBeGreaterThan(Date.now());

    // Cleanup
    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, session.id));
  });

  it("approveSession transitions pending to active", async () => {
    const session = await createSession({
      tableId,
      branchId,
      organizationId: orgId,
      customerName: "Test",
      token: "tok_test2",
      status: "pending",
    });

    const result = await approveSession({ sessionId: session.id, branchId });
    expect(result.session.status).toBe("active");
    expect(result.session.expires_at).toBeTruthy();

    // Verify table is occupied
    const [table] = await db.select().from(schema.tables).where(eq(schema.tables.id, tableId)).limit(1);
    expect(table.status).toBe("occupied");

    // Cleanup: end session to reset table
    await endSession({ sessionId: session.id, branchId });
  });

  it("approveSession rejects expired session", async () => {
    // Create session with already-expired timestamp
    const [session] = await db.insert(schema.tableSessions).values({
      table_id: tableId,
      branch_id: branchId,
      organization_id: orgId,
      customer_name: "Expired",
      token: "tok_expired",
      status: "pending",
      expires_at: new Date(Date.now() - 60_000), // 1 minute ago
    }).returning();

    let caughtError: Error | null = null;
    try {
      await approveSession({ sessionId: session.id, branchId });
    } catch (e: any) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("SESSION_EXPIRED");

    // Verify it was auto-rejected
    const [updated] = await db.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, session.id)).limit(1);
    expect(updated.status).toBe("rejected");

    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, session.id));
  });

  it("rejectSession marks session as rejected", async () => {
    const session = await createSession({
      tableId,
      branchId,
      organizationId: orgId,
      customerName: "Test",
      token: "tok_reject",
      status: "pending",
    });

    const result = await rejectSession({ sessionId: session.id, branchId });
    expect(result.session.status).toBe("rejected");

    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, session.id));
  });

  it("endSession completes session and resets table", async () => {
    const session = await createSession({
      tableId,
      branchId,
      organizationId: orgId,
      customerName: "Test",
      token: "tok_end",
      status: "active",
    });

    // Set table to occupied first
    await db.update(schema.tables).set({ status: "occupied" }).where(eq(schema.tables.id, tableId));

    const result = await endSession({ sessionId: session.id, branchId });
    expect(result.session.status).toBe("completed");
    expect(result.session.ended_at).toBeTruthy();

    const [table] = await db.select().from(schema.tables).where(eq(schema.tables.id, tableId)).limit(1);
    expect(table.status).toBe("available");

    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, session.id));
  });

  it("expireStale auto-expires stale sessions", async () => {
    // Create an expired pending session
    const [stale] = await db.insert(schema.tableSessions).values({
      table_id: tableId,
      branch_id: branchId,
      organization_id: orgId,
      customer_name: "Stale",
      token: "tok_stale",
      status: "pending",
      expires_at: new Date(Date.now() - 60_000),
    }).returning();

    const count = await expireStale();
    expect(count).toBeGreaterThanOrEqual(1);

    const [updated] = await db.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, stale.id)).limit(1);
    expect(updated.status).toBe("rejected");

    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, stale.id));
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  it("endSession blocks when session has open orders", async () => {
    const session = await createSession({
      tableId,
      branchId,
      organizationId: orgId,
      customerName: "WithOrders",
      token: "tok_open_orders",
      status: "active",
    });

    await db.update(schema.tables).set({ status: "occupied" }).where(eq(schema.tables.id, tableId));

    // Create an open order linked to this session
    const cat = await createTestCategory(branchId, orgId);
    const menuItem = await createTestMenuItem(branchId, orgId, cat.id);
    const [order] = await db.insert(schema.orders).values({
      organization_id: orgId,
      branch_id: branchId,
      table_session_id: session.id,
      order_number: "TEST-SESS-001",
      type: "dine_in",
      status: "preparing", // not completed/cancelled
      subtotal: 1000,
      tax: 180,
      discount: 0,
      total: 1180,
    }).returning();

    let caughtError: Error | null = null;
    try {
      await endSession({ sessionId: session.id, branchId });
    } catch (e: any) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("SESSION_HAS_OPEN_ORDERS");

    // Completar la comanda YA NO basta para cerrar la visita: la cuenta sigue
    // sin cobrarse. Antes esto liberaba la mesa y convertía un impago en venta
    // cerrada (con puntos e inventario descontados) sin traza ninguna.
    await db.update(schema.orders).set({ status: "completed" }).where(eq(schema.orders.id, order.id));

    let balanceError: any = null;
    try {
      await endSession({ sessionId: session.id, branchId });
    } catch (e: any) {
      balanceError = e;
    }
    expect(balanceError).not.toBeNull();
    expect(balanceError.code).toBe("TABLE_HAS_BALANCE");
    expect(balanceError.pendingAmount).toBe(1180);

    // Con la cuenta saldada, la visita se cierra con normalidad.
    await db.insert(schema.payments).values({
      order_id: order.id,
      organization_id: orgId,
      branch_id: branchId,
      method: "cash",
      amount: 1180,
      status: "completed",
    });

    const result = await endSession({ sessionId: session.id, branchId });
    expect(result.session.status).toBe("completed");

    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, session.id));
  });

  it("endSession con force perdona el saldo pendiente", async () => {
    const session = await createSession({
      tableId,
      branchId,
      organizationId: orgId,
      customerName: "Forzada",
      token: "tok_force_end",
      status: "active",
    });

    const cat = await createTestCategory(branchId, orgId);
    const menuItem = await createTestMenuItem(branchId, orgId, cat.id);
    await db.insert(schema.orders).values({
      organization_id: orgId,
      branch_id: branchId,
      table_session_id: session.id,
      order_number: "TEST-SESS-FORCE",
      type: "dine_in",
      status: "completed",
      subtotal: 2000,
      tax: 360,
      discount: 0,
      total: 2360,
    });

    // Sin force: bloqueado.
    await expect(endSession({ sessionId: session.id, branchId })).rejects.toThrow();

    // Con force: se cierra. El endpoint restringe esto a `payments:void` y lo audita.
    const forced = await endSession({ sessionId: session.id, branchId, force: true });
    expect(forced.session.status).toBe("completed");

    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, session.id));
  });

  it("double approveSession race — second call fails", async () => {
    const session = await createSession({
      tableId,
      branchId,
      organizationId: orgId,
      customerName: "RaceTest",
      token: "tok_race",
      status: "pending",
    });

    // First approve succeeds
    await approveSession({ sessionId: session.id, branchId });

    // Second approve fails (no longer pending)
    let caughtError: Error | null = null;
    try {
      await approveSession({ sessionId: session.id, branchId });
    } catch (e: any) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("PENDING_SESSION_NOT_FOUND");

    await endSession({ sessionId: session.id, branchId });
    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, session.id));
  });

  it("expireStale skips active sessions with open orders", async () => {
    const table2 = await createTestTable(branchId, orgId, 999);
    const [activeSession] = await db.insert(schema.tableSessions).values({
      table_id: table2.id,
      branch_id: branchId,
      organization_id: orgId,
      customer_name: "ActiveWithOrder",
      token: "tok_active_order",
      status: "active",
      expires_at: new Date(Date.now() - 60_000), // expired
    }).returning();

    // Create open order
    const cat = await createTestCategory(branchId, orgId);
    const menuItem = await createTestMenuItem(branchId, orgId, cat.id);
    await db.insert(schema.orders).values({
      organization_id: orgId,
      branch_id: branchId,
      table_session_id: activeSession.id,
      order_number: "TEST-SESS-002",
      type: "dine_in",
      status: "pending",
      subtotal: 500,
      tax: 90,
      discount: 0,
      total: 590,
    });

    await expireStale();

    // Session should NOT be expired because it has open orders
    const [sess] = await db.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, activeSession.id)).limit(1);
    expect(sess.status).toBe("active");

    // Cleanup
    await db.delete(schema.orders).where(eq(schema.orders.table_session_id, activeSession.id));
    await db.delete(schema.tableSessions).where(eq(schema.tableSessions.id, activeSession.id));
    await db.delete(schema.tables).where(eq(schema.tables.id, table2.id));
  });
});
