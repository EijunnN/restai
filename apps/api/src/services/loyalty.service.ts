import { eq, and, desc, gte, lte, lt, sql, isNull, isNotNull, or } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import { sendLoyaltyEmail } from "../lib/notifications.js";
import { logger } from "../lib/logger.js";
import { getActiveCampaignBoost } from "./campaign.service.js";
import { completeReferralForFirstOrder } from "./referral.service.js";

// Default birthday bonus, in whole points. Kept as a const so the value lives in
// one place (and the idempotency guard below references the same constant).
const BIRTHDAY_BONUS_POINTS = 50;

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

  // Check if enrollment already exists for this customer+program
  const [existing] = await txOrDb
    .select()
    .from(schema.customerLoyalty)
    .where(
      and(
        eq(schema.customerLoyalty.customer_id, customerId),
        eq(schema.customerLoyalty.program_id, program.id),
      ),
    )
    .limit(1);

  if (existing) return existing;

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

  const result = await db.transaction(async (tx) => {
    // Idempotency: check if points were already awarded for this order
    const [existingTx] = await tx
      .select({ id: schema.loyaltyTransactions.id })
      .from(schema.loyaltyTransactions)
      .where(
        and(
          eq(schema.loyaltyTransactions.order_id, orderId),
          eq(schema.loyaltyTransactions.type, "earned"),
        ),
      )
      .limit(1);

    if (existingTx) return null;

    // Find customer's loyalty enrollment with program info + tier multiplier (inside tx).
    // Joins gate on the ACTIVE program for this organization, so points always
    // target the customer's enrollment in the org's active program.
    const [enrollment] = await tx
      .select({
        id: schema.customerLoyalty.id,
        points_balance: schema.customerLoyalty.points_balance,
        total_points_earned: schema.customerLoyalty.total_points_earned,
        tier_id: schema.customerLoyalty.tier_id,
        program_id: schema.customerLoyalty.program_id,
        points_per_currency_unit: schema.loyaltyPrograms.points_per_currency_unit,
        points_expire_after_days: schema.loyaltyPrograms.points_expire_after_days,
        multiplier: schema.loyaltyTiers.multiplier,
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
      .leftJoin(
        schema.loyaltyTiers,
        eq(schema.customerLoyalty.tier_id, schema.loyaltyTiers.id),
      )
      .where(eq(schema.customerLoyalty.customer_id, customerId))
      .limit(1);

    if (!enrollment) return null;

    // Calculate base points with tier multiplier
    const multiplier = enrollment.multiplier ?? 100;
    const basePoints = Math.floor(
      Math.floor(orderTotal / 100) * enrollment.points_per_currency_unit * multiplier / 100,
    );

    // Apply any active earning campaign (extra multiplier + flat bonus) matching
    // now, the customer's tier, and the day/time window.
    const boost = await getActiveCampaignBoost({
      organizationId,
      tierId: enrollment.tier_id,
      at: new Date(),
    });
    const pointsEarned = Math.floor((basePoints * boost.multiplier) / 100) + boost.bonusPoints;

    if (pointsEarned <= 0) return null;

    // Compute expiry stamp for the earned row: now + N days when the program has
    // an expiry policy; null = never expires.
    let expiresAt: Date | null = null;
    if (
      enrollment.points_expire_after_days != null &&
      enrollment.points_expire_after_days > 0
    ) {
      expiresAt = new Date(
        Date.now() + enrollment.points_expire_after_days * 24 * 60 * 60 * 1000,
      );
    }

    // Atomic balance update
    await tx
      .update(schema.customerLoyalty)
      .set({
        points_balance: sql`${schema.customerLoyalty.points_balance} + ${pointsEarned}`,
        total_points_earned: sql`${schema.customerLoyalty.total_points_earned} + ${pointsEarned}`,
      })
      .where(eq(schema.customerLoyalty.id, enrollment.id));

    await tx.insert(schema.loyaltyTransactions).values({
      customer_loyalty_id: enrollment.id,
      order_id: orderId,
      points: pointsEarned,
      type: "earned",
      description: `Orden #${orderNumber} completada`,
      expires_at: expiresAt,
    });

    // Re-read totals for tier check
    const newTotal = enrollment.total_points_earned + pointsEarned;
    const newBalance = enrollment.points_balance + pointsEarned;
    const previousBalance = enrollment.points_balance;

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

    // Find a reward this award newly made affordable (balance crossed its cost):
    // previousBalance < cost <= newBalance. Cheapest such reward, active + in window.
    const now = new Date();
    const [unlockedReward] = await tx
      .select({
        name: schema.rewards.name,
        points_cost: schema.rewards.points_cost,
      })
      .from(schema.rewards)
      .where(
        and(
          eq(schema.rewards.program_id, enrollment.program_id),
          eq(schema.rewards.is_active, true),
          gte(schema.rewards.points_cost, previousBalance + 1),
          lte(schema.rewards.points_cost, newBalance),
          or(isNull(schema.rewards.starts_at), lte(schema.rewards.starts_at, now)),
          or(isNull(schema.rewards.expires_at), gte(schema.rewards.expires_at, now)),
          or(isNull(schema.rewards.stock_remaining), gte(schema.rewards.stock_remaining, 1)),
        ),
      )
      .orderBy(schema.rewards.points_cost)
      .limit(1);

    return {
      result: { pointsEarned, newBalance, newTotal },
      customerLoyaltyId: enrollment.id,
      unlockedReward: unlockedReward ?? null,
    };
  });

  // Complete a pending referral for this customer on their qualifying order.
  // Runs outside the award tx (uses its own), idempotent via the service's
  // pending->completed guard, and best-effort so it never breaks point awarding.
  try {
    await completeReferralForFirstOrder({ organizationId, customerId });
  } catch (err) {
    logger.warn("referral completion failed", {
      customerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!result) return null;

  // Best-effort notifications, outside the transaction. Fetch the customer's
  // email + consent + org name; sendLoyaltyEmail is consent-gated and never throws.
  try {
    const [customer] = await db
      .select({
        name: schema.customers.name,
        email: schema.customers.email,
        marketing_opt_in: schema.customers.marketing_opt_in,
        org_name: schema.organizations.name,
      })
      .from(schema.customers)
      .innerJoin(
        schema.organizations,
        eq(schema.customers.organization_id, schema.organizations.id),
      )
      .where(eq(schema.customers.id, customerId))
      .limit(1);

    if (customer) {
      await sendLoyaltyEmail({
        organizationId,
        customerId,
        toAddress: customer.email,
        marketingOptIn: customer.marketing_opt_in,
        type: "points_earned",
        orgName: customer.org_name,
        data: {
          customerName: customer.name,
          points: result.result.pointsEarned,
          balance: result.result.newBalance,
        },
      });

      if (result.unlockedReward) {
        await sendLoyaltyEmail({
          organizationId,
          customerId,
          toAddress: customer.email,
          marketingOptIn: customer.marketing_opt_in,
          type: "reward_unlocked",
          orgName: customer.org_name,
          data: {
            customerName: customer.name,
            rewardName: result.unlockedReward.name,
            pointsCost: result.unlockedReward.points_cost,
            balance: result.result.newBalance,
          },
        });
      }
    }
  } catch (err) {
    logger.warn("awardPoints notification failed", {
      customerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result.result;
}

// ---------------------------------------------------------------------------
// redeemReward
// ---------------------------------------------------------------------------

export async function redeemReward(params: {
  rewardId: string;
  customerLoyaltyId: string;
  organizationId: string;
  orderId?: string;
}) {
  const { rewardId, customerLoyaltyId, organizationId, orderId } = params;

  return await db.transaction(async (tx) => {
    // Get reward
    const [reward] = await tx
      .select()
      .from(schema.rewards)
      .where(eq(schema.rewards.id, rewardId))
      .limit(1);

    if (!reward || !reward.is_active) {
      throw new Error("REWARD_NOT_FOUND");
    }

    // Get customer loyalty
    const [cl] = await tx
      .select()
      .from(schema.customerLoyalty)
      .where(eq(schema.customerLoyalty.id, customerLoyaltyId))
      .limit(1);

    if (!cl) {
      throw new Error("LOYALTY_NOT_FOUND");
    }

    // Validate program match
    if (reward.program_id !== cl.program_id) {
      throw new Error("PROGRAM_MISMATCH");
    }

    // Validate org ownership via program
    const [program] = await tx
      .select({ id: schema.loyaltyPrograms.id })
      .from(schema.loyaltyPrograms)
      .where(
        and(
          eq(schema.loyaltyPrograms.id, reward.program_id),
          eq(schema.loyaltyPrograms.organization_id, organizationId),
        ),
      )
      .limit(1);

    if (!program) {
      throw new Error("REWARD_NOT_FOUND");
    }

    // Availability window: starts_at <= now <= expires_at (nulls = open-ended).
    const now = new Date();
    if (reward.starts_at && reward.starts_at > now) {
      throw new Error("REWARD_NOT_AVAILABLE");
    }
    if (reward.expires_at && reward.expires_at < now) {
      throw new Error("REWARD_NOT_AVAILABLE");
    }

    // Per-customer cap: count this customer's prior redemptions of this reward.
    if (reward.max_per_customer != null) {
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.rewardRedemptions)
        .where(
          and(
            eq(schema.rewardRedemptions.customer_loyalty_id, customerLoyaltyId),
            eq(schema.rewardRedemptions.reward_id, rewardId),
          ),
        );
      if (count >= reward.max_per_customer) {
        throw new Error("MAX_PER_CUSTOMER");
      }
    }

    // Atomic stock decrement: only succeeds while stock is unlimited (null) or > 0.
    // 0 rows affected => out of stock. Skip entirely when stock is unlimited.
    if (reward.stock_remaining != null) {
      const stockUpdated = await tx
        .update(schema.rewards)
        .set({
          stock_remaining: sql`${schema.rewards.stock_remaining} - 1`,
        })
        .where(
          and(
            eq(schema.rewards.id, rewardId),
            sql`${schema.rewards.stock_remaining} IS NULL OR ${schema.rewards.stock_remaining} > 0`,
          ),
        )
        .returning({ id: schema.rewards.id });

      if (stockUpdated.length === 0) {
        throw new Error("AGOTADO");
      }
    }

    // Atomic deduction with balance guard
    const [updated] = await tx
      .update(schema.customerLoyalty)
      .set({
        points_balance: sql`${schema.customerLoyalty.points_balance} - ${reward.points_cost}`,
      })
      .where(
        and(
          eq(schema.customerLoyalty.id, customerLoyaltyId),
          sql`${schema.customerLoyalty.points_balance} >= ${reward.points_cost}`,
        ),
      )
      .returning();

    if (!updated) {
      // Roll the whole tx back so the stock decrement above is undone too.
      throw new Error("INSUFFICIENT_POINTS");
    }

    await tx.insert(schema.loyaltyTransactions).values({
      customer_loyalty_id: customerLoyaltyId,
      order_id: orderId,
      points: -reward.points_cost,
      type: "redeemed",
      description: `Canje: ${reward.name}`,
    });

    // Snapshot the reward's value at redeem time so later admin edits never
    // retroactively change this claimed redemption.
    const [redemption] = await tx
      .insert(schema.rewardRedemptions)
      .values({
        customer_loyalty_id: customerLoyaltyId,
        reward_id: rewardId,
        order_id: orderId,
        reward_type: reward.reward_type,
        discount_type: reward.discount_type,
        discount_value: reward.discount_value,
        menu_item_id: reward.menu_item_id,
        points_spent: reward.points_cost,
      })
      .returning();

    return {
      redemption,
      discount: {
        type: reward.discount_type,
        value: reward.discount_value,
      },
      pointsDeducted: reward.points_cost,
      newBalance: updated.points_balance,
    };
  });
}

// ---------------------------------------------------------------------------
// adjustPoints
// ---------------------------------------------------------------------------

/**
 * Manual signed adjustment of a customer's points balance (admin tool).
 * Writes an 'adjusted' loyalty_transaction and updates the balance, clamped at
 * >= 0. total_points_earned is never touched (it is a lifetime-earned metric, so
 * negative adjustments and reversals must not reduce it). Returns the new balance.
 */
export async function adjustPoints(params: {
  organizationId: string;
  customerId: string;
  amount: number; // signed integer
  reason: string;
  performedBy?: string;
}) {
  const { organizationId, customerId, amount, reason, performedBy } = params;
  const delta = Math.trunc(amount);

  return await db.transaction(async (tx) => {
    // Resolve the customer's enrollment in the org's ACTIVE program.
    const [enrollment] = await tx
      .select({
        id: schema.customerLoyalty.id,
        points_balance: schema.customerLoyalty.points_balance,
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

    if (!enrollment) {
      throw new Error("LOYALTY_NOT_FOUND");
    }

    if (delta === 0) {
      return { newBalance: enrollment.points_balance };
    }

    // Clamp balance >= 0 (a large negative adjustment can't drive it below zero).
    const [updated] = await tx
      .update(schema.customerLoyalty)
      .set({
        points_balance: sql`GREATEST(${schema.customerLoyalty.points_balance} + ${delta}, 0)`,
      })
      .where(eq(schema.customerLoyalty.id, enrollment.id))
      .returning({ points_balance: schema.customerLoyalty.points_balance });

    // Record the actual delta applied, so the ledger reconciles with the balance
    // even when the clamp truncated a large negative adjustment.
    const appliedDelta = updated.points_balance - enrollment.points_balance;

    const description = performedBy ? `${reason} (por ${performedBy})` : reason;

    await tx.insert(schema.loyaltyTransactions).values({
      customer_loyalty_id: enrollment.id,
      points: appliedDelta,
      type: "adjusted",
      description,
    });

    return { newBalance: updated.points_balance };
  });
}

// ---------------------------------------------------------------------------
// expirePoints
// ---------------------------------------------------------------------------

/**
 * Set-based expiry job. For every still-unexpired 'earned' row whose expires_at
 * has passed, write a negative 'expired' transaction, decrement the enrollment's
 * points_balance (clamped >= 0, total_points_earned untouched), and mark the
 * source rows expired=true. Returns the number of earned rows expired.
 */
export async function expirePoints(): Promise<{ expired: number }> {
  return await db.transaction(async (tx) => {
    const now = new Date();

    // Find all earned rows that have passed their expiry and aren't yet expired.
    const dueRows = await tx
      .select({
        id: schema.loyaltyTransactions.id,
        customer_loyalty_id: schema.loyaltyTransactions.customer_loyalty_id,
        points: schema.loyaltyTransactions.points,
        expires_at: schema.loyaltyTransactions.expires_at,
      })
      .from(schema.loyaltyTransactions)
      .where(
        and(
          eq(schema.loyaltyTransactions.type, "earned"),
          eq(schema.loyaltyTransactions.expired, false),
          isNotNull(schema.loyaltyTransactions.expires_at),
          lt(schema.loyaltyTransactions.expires_at, now),
        ),
      );

    if (dueRows.length === 0) return { expired: 0 };

    // Aggregate points to expire per enrollment.
    const perEnrollment = new Map<string, number>();
    for (const row of dueRows) {
      const pts = row.points > 0 ? row.points : 0;
      perEnrollment.set(
        row.customer_loyalty_id,
        (perEnrollment.get(row.customer_loyalty_id) ?? 0) + pts,
      );
    }

    for (const [customerLoyaltyId, totalToExpire] of perEnrollment) {
      if (totalToExpire <= 0) continue;

      // Read the current balance to compute the actual (clamped) amount expired,
      // so the ledger reconciles with the balance.
      const [cl] = await tx
        .select({ points_balance: schema.customerLoyalty.points_balance })
        .from(schema.customerLoyalty)
        .where(eq(schema.customerLoyalty.id, customerLoyaltyId))
        .limit(1);

      if (!cl) continue;

      const actuallyExpired = Math.min(cl.points_balance, totalToExpire);

      if (actuallyExpired > 0) {
        await tx
          .update(schema.customerLoyalty)
          .set({
            points_balance: sql`GREATEST(${schema.customerLoyalty.points_balance} - ${actuallyExpired}, 0)`,
          })
          .where(eq(schema.customerLoyalty.id, customerLoyaltyId));

        await tx.insert(schema.loyaltyTransactions).values({
          customer_loyalty_id: customerLoyaltyId,
          points: -actuallyExpired,
          type: "expired",
          description: "Puntos expirados",
        });
      }
    }

    // Mark all the due earned rows as expired so they are never re-processed.
    const dueIds = dueRows.map((r) => r.id);
    for (const id of dueIds) {
      await tx
        .update(schema.loyaltyTransactions)
        .set({ expired: true })
        .where(eq(schema.loyaltyTransactions.id, id));
    }

    return { expired: dueRows.length };
  });
}

// ---------------------------------------------------------------------------
// voidOrderPoints
// ---------------------------------------------------------------------------

/**
 * Reverse the points awarded for a completed order (post-completion clawback).
 * Idempotent on order_id: if a reversal ('adjusted' tx tagged with the order)
 * already exists, it's a no-op. Writes a negative 'adjusted' tx and decrements
 * the balance (clamped >= 0, total_points_earned untouched).
 */
export async function voidOrderPoints(params: {
  organizationId: string;
  orderId: string;
}): Promise<{ reversed: boolean; pointsReversed: number }> {
  const { organizationId, orderId } = params;
  const VOID_TAG = `[void:${orderId}]`;

  return await db.transaction(async (tx) => {
    // Find the 'earned' transaction for this order, scoped to the org's program.
    const [earned] = await tx
      .select({
        id: schema.loyaltyTransactions.id,
        customer_loyalty_id: schema.loyaltyTransactions.customer_loyalty_id,
        points: schema.loyaltyTransactions.points,
      })
      .from(schema.loyaltyTransactions)
      .innerJoin(
        schema.customerLoyalty,
        eq(schema.loyaltyTransactions.customer_loyalty_id, schema.customerLoyalty.id),
      )
      .innerJoin(
        schema.loyaltyPrograms,
        and(
          eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
          eq(schema.loyaltyPrograms.organization_id, organizationId),
        ),
      )
      .where(
        and(
          eq(schema.loyaltyTransactions.order_id, orderId),
          eq(schema.loyaltyTransactions.type, "earned"),
        ),
      )
      .limit(1);

    if (!earned || earned.points <= 0) {
      // Nothing was awarded for this order; nothing to reverse.
      return { reversed: false, pointsReversed: 0 };
    }

    // Idempotency: has a reversal already been written for this order?
    const [existingReversal] = await tx
      .select({ id: schema.loyaltyTransactions.id })
      .from(schema.loyaltyTransactions)
      .where(
        and(
          eq(schema.loyaltyTransactions.customer_loyalty_id, earned.customer_loyalty_id),
          eq(schema.loyaltyTransactions.order_id, orderId),
          eq(schema.loyaltyTransactions.type, "adjusted"),
        ),
      )
      .limit(1);

    if (existingReversal) {
      return { reversed: false, pointsReversed: 0 };
    }

    // Decrement the balance, clamped at 0. total_points_earned is untouched.
    const [updated] = await tx
      .update(schema.customerLoyalty)
      .set({
        points_balance: sql`GREATEST(${schema.customerLoyalty.points_balance} - ${earned.points}, 0)`,
      })
      .where(eq(schema.customerLoyalty.id, earned.customer_loyalty_id))
      .returning({ points_balance: schema.customerLoyalty.points_balance });

    await tx.insert(schema.loyaltyTransactions).values({
      customer_loyalty_id: earned.customer_loyalty_id,
      order_id: orderId,
      points: -earned.points,
      type: "adjusted",
      description: `Reversión de puntos por anulación de orden ${VOID_TAG}`,
    });

    void updated;
    return { reversed: true, pointsReversed: earned.points };
  });
}

// ---------------------------------------------------------------------------
// awardBirthdayBonuses
// ---------------------------------------------------------------------------

/**
 * Award a fixed birthday bonus to every customer whose birth_date month/day is
 * today, scoped per organization to that org's ACTIVE program enrollment.
 * Idempotent per customer per YEAR (guarded by an existing 'adjusted' tx whose
 * description carries the year). Sends a best-effort 'birthday' email.
 * Returns the number of customers awarded.
 */
export async function awardBirthdayBonuses(): Promise<{ awarded: number }> {
  const now = new Date();
  const year = now.getFullYear();
  const reason = `Cumpleaños ${year}`;

  // Customers whose birth month/day match today, enrolled in their org's active
  // program. Compare month/day via SQL so it's a single set-based scan.
  const candidates = await db
    .select({
      customer_id: schema.customers.id,
      organization_id: schema.customers.organization_id,
      name: schema.customers.name,
      email: schema.customers.email,
      marketing_opt_in: schema.customers.marketing_opt_in,
      org_name: schema.organizations.name,
      customer_loyalty_id: schema.customerLoyalty.id,
    })
    .from(schema.customers)
    .innerJoin(
      schema.organizations,
      eq(schema.customers.organization_id, schema.organizations.id),
    )
    .innerJoin(
      schema.customerLoyalty,
      eq(schema.customerLoyalty.customer_id, schema.customers.id),
    )
    .innerJoin(
      schema.loyaltyPrograms,
      and(
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
        eq(schema.loyaltyPrograms.organization_id, schema.customers.organization_id),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .where(
      and(
        isNotNull(schema.customers.birth_date),
        sql`EXTRACT(MONTH FROM ${schema.customers.birth_date}) = ${now.getMonth() + 1}`,
        sql`EXTRACT(DAY FROM ${schema.customers.birth_date}) = ${now.getDate()}`,
      ),
    );

  let awarded = 0;

  for (const c of candidates) {
    try {
      const didAward = await db.transaction(async (tx) => {
        // Idempotency per customer per year: an 'adjusted' tx for this enrollment
        // whose description contains the year's reason already exists?
        const [existing] = await tx
          .select({ id: schema.loyaltyTransactions.id })
          .from(schema.loyaltyTransactions)
          .where(
            and(
              eq(schema.loyaltyTransactions.customer_loyalty_id, c.customer_loyalty_id),
              eq(schema.loyaltyTransactions.type, "adjusted"),
              sql`${schema.loyaltyTransactions.description} LIKE ${`%${reason}%`}`,
            ),
          )
          .limit(1);

        if (existing) return false;

        await tx
          .update(schema.customerLoyalty)
          .set({
            points_balance: sql`GREATEST(${schema.customerLoyalty.points_balance} + ${BIRTHDAY_BONUS_POINTS}, 0)`,
          })
          .where(eq(schema.customerLoyalty.id, c.customer_loyalty_id));

        await tx.insert(schema.loyaltyTransactions).values({
          customer_loyalty_id: c.customer_loyalty_id,
          points: BIRTHDAY_BONUS_POINTS,
          type: "adjusted",
          description: reason,
        });

        return true;
      });

      if (!didAward) continue;
      awarded++;

      // Best-effort birthday email (consent-gated, never throws).
      await sendLoyaltyEmail({
        organizationId: c.organization_id,
        customerId: c.customer_id,
        toAddress: c.email,
        marketingOptIn: c.marketing_opt_in,
        type: "birthday",
        orgName: c.org_name,
        data: {
          customerName: c.name,
          rewardDescription: `${BIRTHDAY_BONUS_POINTS} puntos de regalo`,
        },
      });
    } catch (err) {
      logger.warn("awardBirthdayBonuses failed for customer", {
        customerId: c.customer_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { awarded };
}
