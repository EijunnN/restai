import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestOrg, createTestBranch, createTestTable, cleanup } from "../setup";
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
});
