import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestOrg, createTestCustomer, createTestLoyaltyProgram, createTestTier, createTestReward, cleanup } from "../setup";
import { enrollCustomer, awardPoints, redeemReward } from "../../services/loyalty.service";
import { db, schema } from "@restai/db";
import { eq } from "drizzle-orm";

describe("loyalty.service", () => {
  let orgId: string;
  let customerId: string;
  let programId: string;
  let baseTierId: string;
  let enrollmentId: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const customer = await createTestCustomer(orgId);
    customerId = customer.id;
    const program = await createTestLoyaltyProgram(orgId);
    programId = program.id;
    const baseTier = await createTestTier(programId, 0, 100); // 1x multiplier
    baseTierId = baseTier.id;
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  it("enrollCustomer creates enrollment with base tier", async () => {
    const enrollment = await enrollCustomer({ customerId, organizationId: orgId });
    expect(enrollment).toBeTruthy();
    expect(enrollment!.customer_id).toBe(customerId);
    expect(enrollment!.program_id).toBe(programId);
    expect(enrollment!.points_balance).toBe(0);
    expect(enrollment!.tier_id).toBe(baseTierId);
    enrollmentId = enrollment!.id;
  });

  it("enrollCustomer is idempotent (returns existing)", async () => {
    const enrollment = await enrollCustomer({ customerId, organizationId: orgId });
    expect(enrollment!.id).toBe(enrollmentId);
  });

  it("enrollCustomer returns null if no active program", async () => {
    const org2 = await createTestOrg();
    const cust2 = await createTestCustomer(org2.id);
    const result = await enrollCustomer({ customerId: cust2.id, organizationId: org2.id });
    expect(result).toBeNull();
    await cleanup([org2.id]);
  });

  it("awardPoints calculates points with tier multiplier", async () => {
    // Create a test order ID
    const orderId = crypto.randomUUID();
    const result = await awardPoints({
      customerId,
      orderId,
      orderTotal: 5000, // 50.00 soles
      orderNumber: "TEST-LP-001",
      organizationId: orgId,
    });

    expect(result).toBeTruthy();
    // points = floor(5000/100) * 1 * 100/100 = 50
    expect(result!.pointsEarned).toBe(50);

    // Verify balance updated
    const [cl] = await db.select().from(schema.customerLoyalty).where(eq(schema.customerLoyalty.id, enrollmentId)).limit(1);
    expect(cl.points_balance).toBe(50);
    expect(cl.total_points_earned).toBe(50);
  });

  it("awardPoints is idempotent (same orderId)", async () => {
    const orderId = crypto.randomUUID();
    await awardPoints({
      customerId,
      orderId,
      orderTotal: 3000,
      orderNumber: "TEST-LP-002",
      organizationId: orgId,
    });

    // Call again with same orderId
    const result2 = await awardPoints({
      customerId,
      orderId,
      orderTotal: 3000,
      orderNumber: "TEST-LP-002",
      organizationId: orgId,
    });

    expect(result2).toBeNull(); // Idempotency: returns null
  });

  it("awardPoints triggers tier upgrade", async () => {
    // Create a high tier
    const goldTier = await createTestTier(programId, 100, 150); // needs 100 points

    // Award enough points to qualify
    const orderId = crypto.randomUUID();
    await awardPoints({
      customerId,
      orderId,
      orderTotal: 10000, // 100.00 soles = 100 points
      orderNumber: "TEST-LP-003",
      organizationId: orgId,
    });

    // Check tier was upgraded
    const [cl] = await db.select().from(schema.customerLoyalty).where(eq(schema.customerLoyalty.id, enrollmentId)).limit(1);
    expect(cl.tier_id).toBe(goldTier.id);
  });

  it("redeemReward deducts points and creates redemption", async () => {
    // Ensure customer has enough points
    const [cl] = await db.select().from(schema.customerLoyalty).where(eq(schema.customerLoyalty.id, enrollmentId)).limit(1);
    const balanceBefore = cl.points_balance;

    const reward = await createTestReward(programId, 50); // costs 50 points

    const result = await redeemReward({
      rewardId: reward.id,
      customerLoyaltyId: enrollmentId,
      organizationId: orgId,
    });

    expect(result.pointsDeducted).toBe(50);
    expect(result.newBalance).toBe(balanceBefore - 50);
    expect(result.redemption).toBeTruthy();
  });

  it("redeemReward throws INSUFFICIENT_POINTS", async () => {
    const expensiveReward = await createTestReward(programId, 999999);

    let caughtError: Error | null = null;
    try {
      await redeemReward({
        rewardId: expensiveReward.id,
        customerLoyaltyId: enrollmentId,
        organizationId: orgId,
      });
    } catch (e: any) {
      caughtError = e;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("INSUFFICIENT_POINTS");
  });
});
