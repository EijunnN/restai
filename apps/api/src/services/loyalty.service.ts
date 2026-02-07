import { eq, and, desc, gte, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";

// ---------------------------------------------------------------------------
// enrollCustomer
// ---------------------------------------------------------------------------

export async function enrollCustomer(params: {
  customerId: string;
  organizationId: string;
}, txOrDb: DbOrTx = db) {
  const { customerId, organizationId } = params;

  // Find active loyalty program for this organization
  const [program] = await txOrDb
    .select()
    .from(schema.loyaltyPrograms)
    .where(
      and(
        eq(schema.loyaltyPrograms.organization_id, organizationId),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .limit(1);

  if (!program) return null;

  // Find the lowest tier
  const [baseTier] = await txOrDb
    .select()
    .from(schema.loyaltyTiers)
    .where(eq(schema.loyaltyTiers.program_id, program.id))
    .orderBy(schema.loyaltyTiers.min_points)
    .limit(1);

  const [enrollment] = await txOrDb
    .insert(schema.customerLoyalty)
    .values({
      customer_id: customerId,
      program_id: program.id,
      points_balance: 0,
      total_points_earned: 0,
      tier_id: baseTier?.id || null,
    })
    .returning();

  return enrollment;
}

// ---------------------------------------------------------------------------
// awardPoints
// ---------------------------------------------------------------------------

export async function awardPoints(params: {
  customerId: string;
  orderId: string;
  orderTotal: number;
  orderNumber: string;
  organizationId: string;
}) {
  const { customerId, orderId, orderTotal, orderNumber, organizationId } = params;

  // Find customer's loyalty enrollment with program info
  const [enrollment] = await db
    .select({
      id: schema.customerLoyalty.id,
      points_balance: schema.customerLoyalty.points_balance,
      total_points_earned: schema.customerLoyalty.total_points_earned,
      tier_id: schema.customerLoyalty.tier_id,
      program_id: schema.customerLoyalty.program_id,
      points_per_currency_unit: schema.loyaltyPrograms.points_per_currency_unit,
    })
    .from(schema.customerLoyalty)
    .innerJoin(
      schema.loyaltyPrograms,
      and(
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
        eq(schema.loyaltyPrograms.organization_id, organizationId),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .where(eq(schema.customerLoyalty.customer_id, customerId))
    .limit(1);

  if (!enrollment) return null;

  // Calculate points: total is in cents, divide by 100 for soles, multiply by rate
  const pointsEarned = Math.floor(orderTotal / 100) * enrollment.points_per_currency_unit;

  if (pointsEarned <= 0) return null;

  const newBalance = enrollment.points_balance + pointsEarned;
  const newTotal = enrollment.total_points_earned + pointsEarned;

  // Wrap writes in a transaction
  await db.transaction(async (tx) => {
    await tx
      .update(schema.customerLoyalty)
      .set({
        points_balance: newBalance,
        total_points_earned: newTotal,
      })
      .where(eq(schema.customerLoyalty.id, enrollment.id));

    await tx.insert(schema.loyaltyTransactions).values({
      customer_loyalty_id: enrollment.id,
      order_id: orderId,
      points: pointsEarned,
      type: "earned",
      description: `Orden #${orderNumber} completada`,
    });

    // Check tier upgrade: find the highest tier the customer qualifies for
    const [nextTier] = await tx
      .select()
      .from(schema.loyaltyTiers)
      .where(
        and(
          eq(schema.loyaltyTiers.program_id, enrollment.program_id),
          gte(sql`${newTotal}`, schema.loyaltyTiers.min_points),
        ),
      )
      .orderBy(desc(schema.loyaltyTiers.min_points))
      .limit(1);

    if (nextTier && nextTier.id !== enrollment.tier_id) {
      await tx
        .update(schema.customerLoyalty)
        .set({ tier_id: nextTier.id })
        .where(eq(schema.customerLoyalty.id, enrollment.id));
    }
  });

  return { pointsEarned, newBalance, newTotal };
}

// ---------------------------------------------------------------------------
// redeemReward
// ---------------------------------------------------------------------------

export async function redeemReward(params: {
  rewardId: string;
  customerLoyaltyId: string;
  orderId?: string;
}) {
  const { rewardId, customerLoyaltyId, orderId } = params;

  // Get reward
  const [reward] = await db
    .select()
    .from(schema.rewards)
    .where(eq(schema.rewards.id, rewardId))
    .limit(1);

  if (!reward || !reward.is_active) {
    throw new Error("REWARD_NOT_FOUND");
  }

  // Get customer loyalty
  const [cl] = await db
    .select()
    .from(schema.customerLoyalty)
    .where(eq(schema.customerLoyalty.id, customerLoyaltyId))
    .limit(1);

  if (!cl) {
    throw new Error("LOYALTY_NOT_FOUND");
  }

  if (cl.points_balance < reward.points_cost) {
    throw new Error("INSUFFICIENT_POINTS");
  }

  // Wrap writes in a transaction
  const [redemption] = await db.transaction(async (tx) => {
    await tx
      .update(schema.customerLoyalty)
      .set({ points_balance: cl.points_balance - reward.points_cost })
      .where(eq(schema.customerLoyalty.id, customerLoyaltyId));

    await tx.insert(schema.loyaltyTransactions).values({
      customer_loyalty_id: customerLoyaltyId,
      order_id: orderId,
      points: -reward.points_cost,
      type: "redeemed",
      description: `Canje: ${reward.name}`,
    });

    const [r] = await tx
      .insert(schema.rewardRedemptions)
      .values({
        customer_loyalty_id: customerLoyaltyId,
        reward_id: rewardId,
        order_id: orderId,
      })
      .returning();

    return [r];
  });

  return {
    redemption,
    discount: {
      type: reward.discount_type,
      value: reward.discount_value,
    },
    pointsDeducted: reward.points_cost,
    newBalance: cl.points_balance - reward.points_cost,
  };
}
