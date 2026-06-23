import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, sql, like, or } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createLoyaltyProgramSchema,
  createCustomerSchema,
  idParamSchema,
  customerSearchSchema,
} from "@restai/validators";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { findOrCreateByPhone } from "../services/customer.service.js";
import { redeemReward, adjustPoints } from "../services/loyalty.service.js";

const loyalty = new Hono<AppEnv>();

loyalty.use("*", authMiddleware);
loyalty.use("*", tenantMiddleware);

// ---------------------------------------------------------------------------
// STATS
// ---------------------------------------------------------------------------

// GET /stats - Get loyalty statistics
loyalty.get("/stats", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  // Count customers
  const [customerCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.customers)
    .where(eq(schema.customers.organization_id, tenant.organizationId));

  // Total points in circulation
  const [pointsData] = await db
    .select({
      total_balance: sql<number>`coalesce(sum(${schema.customerLoyalty.points_balance}), 0)::int`,
      total_earned: sql<number>`coalesce(sum(${schema.customerLoyalty.total_points_earned}), 0)::int`,
    })
    .from(schema.customerLoyalty)
    .innerJoin(schema.loyaltyPrograms, eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id))
    .where(eq(schema.loyaltyPrograms.organization_id, tenant.organizationId));

  // Redemptions count
  const [redemptionCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.rewardRedemptions)
    .innerJoin(schema.customerLoyalty, eq(schema.rewardRedemptions.customer_loyalty_id, schema.customerLoyalty.id))
    .innerJoin(schema.loyaltyPrograms, eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id))
    .where(eq(schema.loyaltyPrograms.organization_id, tenant.organizationId));

  // Active program
  const [program] = await db
    .select({ id: schema.loyaltyPrograms.id, name: schema.loyaltyPrograms.name })
    .from(schema.loyaltyPrograms)
    .where(and(eq(schema.loyaltyPrograms.organization_id, tenant.organizationId), eq(schema.loyaltyPrograms.is_active, true)))
    .limit(1);

  return c.json({
    success: true,
    data: {
      totalCustomers: customerCount?.count ?? 0,
      totalPointsBalance: pointsData?.total_balance ?? 0,
      totalPointsEarned: pointsData?.total_earned ?? 0,
      totalRedemptions: redemptionCount?.count ?? 0,
      activeProgram: program || null,
    },
  });
});

// GET /analytics - Loyalty program analytics for the org's active program
loyalty.get("/analytics", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  // Active program drives liability valuation (currency_per_point).
  const [activeProgram] = await db
    .select({
      id: schema.loyaltyPrograms.id,
      currency_per_point: schema.loyaltyPrograms.currency_per_point,
    })
    .from(schema.loyaltyPrograms)
    .where(
      and(
        eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .limit(1);

  // Aggregate balances + member counts across this org's enrollments.
  const [memberData] = await db
    .select({
      total_balance: sql<number>`coalesce(sum(${schema.customerLoyalty.points_balance}), 0)::int`,
      active_members: sql<number>`coalesce(sum(case when ${schema.customerLoyalty.points_balance} > 0 then 1 else 0 end), 0)::int`,
      earning_members: sql<number>`coalesce(sum(case when ${schema.customerLoyalty.total_points_earned} > 0 then 1 else 0 end), 0)::int`,
    })
    .from(schema.customerLoyalty)
    .innerJoin(
      schema.loyaltyPrograms,
      eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
    )
    .where(eq(schema.loyaltyPrograms.organization_id, tenant.organizationId));

  // Distinct members who have redeemed at least one reward.
  const [redeemingData] = await db
    .select({
      redeeming_members: sql<number>`count(distinct ${schema.rewardRedemptions.customer_loyalty_id})::int`,
    })
    .from(schema.rewardRedemptions)
    .innerJoin(
      schema.customerLoyalty,
      eq(schema.rewardRedemptions.customer_loyalty_id, schema.customerLoyalty.id),
    )
    .innerJoin(
      schema.loyaltyPrograms,
      eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
    )
    .where(eq(schema.loyaltyPrograms.organization_id, tenant.organizationId));

  // Top redeemed rewards.
  const topRewards = await db
    .select({
      rewardId: schema.rewards.id,
      name: schema.rewards.name,
      redemptions: sql<number>`count(${schema.rewardRedemptions.id})::int`,
    })
    .from(schema.rewardRedemptions)
    .innerJoin(schema.rewards, eq(schema.rewardRedemptions.reward_id, schema.rewards.id))
    .innerJoin(
      schema.loyaltyPrograms,
      eq(schema.rewards.program_id, schema.loyaltyPrograms.id),
    )
    .where(eq(schema.loyaltyPrograms.organization_id, tenant.organizationId))
    .groupBy(schema.rewards.id, schema.rewards.name)
    .orderBy(desc(sql`count(${schema.rewardRedemptions.id})`))
    .limit(5);

  const totalBalance = memberData?.total_balance ?? 0;
  const currencyPerPoint = activeProgram?.currency_per_point ?? 0;
  const earningMembers = memberData?.earning_members ?? 0;
  const redeemingMembers = redeemingData?.redeeming_members ?? 0;

  return c.json({
    success: true,
    data: {
      // currency_per_point is in cents -> liability in cents.
      pointsLiabilityCents: totalBalance * currencyPerPoint,
      activeMembers: memberData?.active_members ?? 0,
      redemptionRate: earningMembers > 0 ? redeemingMembers / earningMembers : 0,
      topRewards,
    },
  });
});

// ---------------------------------------------------------------------------
// CUSTOMERS
// ---------------------------------------------------------------------------

// GET /customers - List customers for org with optional search + pagination
loyalty.get("/customers", requirePermission("customers:read"), zValidator("query", customerSearchSchema), async (c) => {
  const tenant = c.get("tenant") as any;
  const { search, page, limit } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions = [
    eq(schema.customers.organization_id, tenant.organizationId),
  ];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        like(schema.customers.name, pattern),
        like(schema.customers.email, pattern),
        like(schema.customers.phone, pattern),
      )!,
    );
  }

  const [customers, [{ count: total }]] = await Promise.all([
    db
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        phone: schema.customers.phone,
        birth_date: schema.customers.birth_date,
        created_at: schema.customers.created_at,
        points_balance: schema.customerLoyalty.points_balance,
        total_points_earned: schema.customerLoyalty.total_points_earned,
        tier_id: schema.customerLoyalty.tier_id,
        customer_loyalty_id: schema.customerLoyalty.id,
        tier_name: schema.loyaltyTiers.name,
      })
      .from(schema.customers)
      .leftJoin(
        schema.customerLoyalty,
        eq(schema.customers.id, schema.customerLoyalty.customer_id),
      )
      .leftJoin(
        schema.loyaltyTiers,
        eq(schema.customerLoyalty.tier_id, schema.loyaltyTiers.id),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.customers.created_at))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.customers)
      .where(and(...conditions)),
  ]);

  return c.json({
    success: true,
    data: {
      customers,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

// POST /customers - Create or find customer
loyalty.post(
  "/customers",
  requirePermission("customers:create"),
  zValidator("json", createCustomerSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    if (body.phone) {
      const result = await findOrCreateByPhone({
        organizationId: tenant.organizationId,
        phone: body.phone,
        name: body.name,
        email: body.email,
        birthDate: body.birthDate,
      });

      if (!result.isNew) {
        return c.json({ success: true, data: { ...result.customer, loyalty: result.loyalty } });
      }

      return c.json({ success: true, data: { ...result.customer, loyalty: result.loyalty } }, 201);
    }

    // No phone — create without dedup
    const { createCustomer } = await import("../services/customer.service.js");
    const { customer, loyalty } = await createCustomer({
      organizationId: tenant.organizationId,
      name: body.name,
      email: body.email,
      birthDate: body.birthDate,
    });

    return c.json({ success: true, data: { ...customer, loyalty } }, 201);
  },
);

// DELETE /customers/:id - Soft-delete: remove customer and related loyalty data
loyalty.delete(
  "/customers/:id",
  requirePermission("customers:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const tenant = c.get("tenant") as any;
    const { id } = c.req.valid("param");

    // Verify customer belongs to org
    const [customer] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!customer) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
        404,
      );
    }

    // All related tables (customer_loyalty, loyalty_transactions, coupon_assignments)
    // have onDelete: "cascade" — deleting the customer cascades everything.
    await db.delete(schema.customers).where(eq(schema.customers.id, id));

    return c.json({ success: true });
  },
);

// GET /customers/:id - Get customer with loyalty enrollment + last 10 transactions
loyalty.get(
  "/customers/:id",
  requirePermission("customers:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!customer) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
        404,
      );
    }

    // Get loyalty enrollment with tier name
    const loyaltyRows = await db
      .select({
        id: schema.customerLoyalty.id,
        program_id: schema.customerLoyalty.program_id,
        points_balance: schema.customerLoyalty.points_balance,
        total_points_earned: schema.customerLoyalty.total_points_earned,
        tier_id: schema.customerLoyalty.tier_id,
        tier_name: schema.loyaltyTiers.name,
        program_name: schema.loyaltyPrograms.name,
      })
      .from(schema.customerLoyalty)
      .leftJoin(
        schema.loyaltyTiers,
        eq(schema.customerLoyalty.tier_id, schema.loyaltyTiers.id),
      )
      .leftJoin(
        schema.loyaltyPrograms,
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
      )
      .where(eq(schema.customerLoyalty.customer_id, id));

    const loyaltyInfo = loyaltyRows[0] || null;

    // Get last 10 transactions
    let recentTransactions: any[] = [];
    if (loyaltyInfo) {
      recentTransactions = await db
        .select()
        .from(schema.loyaltyTransactions)
        .where(eq(schema.loyaltyTransactions.customer_loyalty_id, loyaltyInfo.id))
        .orderBy(desc(schema.loyaltyTransactions.created_at))
        .limit(10);
    }

    return c.json({
      success: true,
      data: { ...customer, loyalty: loyaltyInfo, recentTransactions },
    });
  },
);

// GET /customers/:id/transactions - Paginated transactions
loyalty.get(
  "/customers/:id/transactions",
  requirePermission("customers:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "20", 10);
    const offset = (page - 1) * limit;

    // Verify the customer belongs to this tenant before exposing transactions
    const [customer] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!customer) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
        404,
      );
    }

    // Get customer loyalty records
    const loyaltyRecords = await db
      .select({ id: schema.customerLoyalty.id })
      .from(schema.customerLoyalty)
      .where(eq(schema.customerLoyalty.customer_id, id));

    if (loyaltyRecords.length === 0) {
      return c.json({ success: true, data: [], pagination: { page, limit, total: 0 } });
    }

    const { inArray } = await import("drizzle-orm");
    const loyaltyIds = loyaltyRecords.map((r) => r.id);

    const [transactions, [{ count: total }]] = await Promise.all([
      db
        .select()
        .from(schema.loyaltyTransactions)
        .where(inArray(schema.loyaltyTransactions.customer_loyalty_id, loyaltyIds))
        .orderBy(desc(schema.loyaltyTransactions.created_at))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.loyaltyTransactions)
        .where(inArray(schema.loyaltyTransactions.customer_loyalty_id, loyaltyIds)),
    ]);

    return c.json({
      success: true,
      data: transactions,
      pagination: { page, limit, total },
    });
  },
);

// POST /customers/:id/adjust-points - Manual signed points adjustment by staff
loyalty.post(
  "/customers/:id/adjust-points",
  requirePermission("loyalty:update"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      // Signed integer: positive credits, negative debits. Non-zero.
      amount: z.number().int().refine((n) => n !== 0, { message: "amount no puede ser 0" }),
      reason: z.string().min(1).max(500),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const { amount, reason } = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;

    // Verify customer belongs to org
    const [customer] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!customer) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
        404,
      );
    }

    try {
      const newBalance = await adjustPoints({
        organizationId: tenant.organizationId,
        customerId: id,
        amount,
        reason,
        performedBy: user?.sub,
      });
      return c.json({ success: true, data: { newBalance } });
    } catch (err: any) {
      if (err.message === "LOYALTY_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Registro de lealtad no encontrado" } },
          404,
        );
      }
      throw err;
    }
  },
);

// PATCH /customers/:id - Update customer profile (org-scoped)
loyalty.patch(
  "/customers/:id",
  requirePermission("customers:update"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().max(255).nullable().optional(),
      phone: z.string().min(1).max(20).nullable().optional(),
      birthDate: z.string().date().nullable().optional(),
      marketingOptIn: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Verify customer belongs to org (load current consent flag to detect flips)
    const [existing] = await db
      .select({
        id: schema.customers.id,
        marketing_opt_in: schema.customers.marketing_opt_in,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
        404,
      );
    }

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.email !== undefined) updates.email = body.email;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.birthDate !== undefined) updates.birth_date = body.birthDate;
    if (body.marketingOptIn !== undefined) {
      updates.marketing_opt_in = body.marketingOptIn;
      // Record consent timestamp only when opt-in flips from false -> true.
      if (body.marketingOptIn === true && !existing.marketing_opt_in) {
        updates.consent_at = new Date();
      }
    }

    const [updated] = await db
      .update(schema.customers)
      .set(updates)
      .where(eq(schema.customers.id, id))
      .returning();

    return c.json({ success: true, data: updated });
  },
);

// POST /customers/:id/merge - Merge a source customer into this (target) customer
loyalty.post(
  "/customers/:id/merge",
  requirePermission("customers:update"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      sourceCustomerId: z.string().uuid(),
    }),
  ),
  async (c) => {
    const { id: targetId } = c.req.valid("param");
    const { sourceCustomerId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    if (targetId === sourceCustomerId) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "No se puede fusionar un cliente consigo mismo" } },
        400,
      );
    }

    try {
      const result = await db.transaction(async (tx) => {
        // Both customers must belong to this org (reject cross-org).
        const [target] = await tx
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(
            and(
              eq(schema.customers.id, targetId),
              eq(schema.customers.organization_id, tenant.organizationId),
            ),
          )
          .limit(1);

        const [source] = await tx
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(
            and(
              eq(schema.customers.id, sourceCustomerId),
              eq(schema.customers.organization_id, tenant.organizationId),
            ),
          )
          .limit(1);

        if (!target) throw new Error("TARGET_NOT_FOUND");
        if (!source) throw new Error("SOURCE_NOT_FOUND");

        // Re-parent simple customer references (orders, coupon redemptions).
        await tx
          .update(schema.orders)
          .set({ customer_id: targetId })
          .where(eq(schema.orders.customer_id, sourceCustomerId));

        await tx
          .update(schema.couponRedemptions)
          .set({ customer_id: targetId })
          .where(eq(schema.couponRedemptions.customer_id, sourceCustomerId));

        // Loyalty is keyed by (customer_id, program_id) with a unique constraint.
        // For each source enrollment: if the target already has an enrollment in the
        // same program, SUM balances/earned into the target row, re-parent the
        // source's transactions/redemptions to the target row, then drop the source
        // row. Otherwise simply re-parent the enrollment row to the target customer.
        const sourceLoyalty = await tx
          .select()
          .from(schema.customerLoyalty)
          .where(eq(schema.customerLoyalty.customer_id, sourceCustomerId));

        for (const sl of sourceLoyalty) {
          const [targetLoyalty] = await tx
            .select()
            .from(schema.customerLoyalty)
            .where(
              and(
                eq(schema.customerLoyalty.customer_id, targetId),
                eq(schema.customerLoyalty.program_id, sl.program_id),
              ),
            )
            .limit(1);

          if (targetLoyalty) {
            // Move transactions + redemptions from source enrollment to target.
            await tx
              .update(schema.loyaltyTransactions)
              .set({ customer_loyalty_id: targetLoyalty.id })
              .where(eq(schema.loyaltyTransactions.customer_loyalty_id, sl.id));

            await tx
              .update(schema.rewardRedemptions)
              .set({ customer_loyalty_id: targetLoyalty.id })
              .where(eq(schema.rewardRedemptions.customer_loyalty_id, sl.id));

            // SUM points into the target enrollment.
            await tx
              .update(schema.customerLoyalty)
              .set({
                points_balance: sql`${schema.customerLoyalty.points_balance} + ${sl.points_balance}`,
                total_points_earned: sql`${schema.customerLoyalty.total_points_earned} + ${sl.total_points_earned}`,
              })
              .where(eq(schema.customerLoyalty.id, targetLoyalty.id));

            // Drop the now-empty source enrollment.
            await tx
              .delete(schema.customerLoyalty)
              .where(eq(schema.customerLoyalty.id, sl.id));
          } else {
            // No conflicting target enrollment — just re-parent the row.
            await tx
              .update(schema.customerLoyalty)
              .set({ customer_id: targetId })
              .where(eq(schema.customerLoyalty.id, sl.id));
          }
        }

        // Re-parent any coupon assignments. The unique (coupon_id, customer_id)
        // constraint can collide if both customers hold the same coupon; drop the
        // source's duplicate assignments first, then re-parent the rest.
        const sourceAssignments = await tx
          .select({ id: schema.couponAssignments.id, coupon_id: schema.couponAssignments.coupon_id })
          .from(schema.couponAssignments)
          .where(eq(schema.couponAssignments.customer_id, sourceCustomerId));

        for (const sa of sourceAssignments) {
          const [dup] = await tx
            .select({ id: schema.couponAssignments.id })
            .from(schema.couponAssignments)
            .where(
              and(
                eq(schema.couponAssignments.customer_id, targetId),
                eq(schema.couponAssignments.coupon_id, sa.coupon_id),
              ),
            )
            .limit(1);

          if (dup) {
            await tx
              .delete(schema.couponAssignments)
              .where(eq(schema.couponAssignments.id, sa.id));
          } else {
            await tx
              .update(schema.couponAssignments)
              .set({ customer_id: targetId })
              .where(eq(schema.couponAssignments.id, sa.id));
          }
        }

        // Finally remove the source customer.
        await tx.delete(schema.customers).where(eq(schema.customers.id, sourceCustomerId));

        return { targetId, mergedFrom: sourceCustomerId };
      });

      return c.json({ success: true, data: result });
    } catch (err: any) {
      if (err.message === "TARGET_NOT_FOUND" || err.message === "SOURCE_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
          404,
        );
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// DATA-SUBJECT RIGHTS (Ley 29733)
// ---------------------------------------------------------------------------

// GET /customers/:id/export - Data-subject access request (Ley 29733).
// Returns a single JSON document with the customer's full record (PII) plus all
// loyalty/transaction/order/referral data linked to them. Strictly org-scoped.
loyalty.get(
  "/customers/:id/export",
  requirePermission("customers:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Full customer record (includes PII) — must belong to this org.
    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!customer) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
        404,
      );
    }

    // Loyalty enrollments for this customer (with tier + program names).
    const loyaltyEnrollments = await db
      .select({
        id: schema.customerLoyalty.id,
        program_id: schema.customerLoyalty.program_id,
        program_name: schema.loyaltyPrograms.name,
        points_balance: schema.customerLoyalty.points_balance,
        total_points_earned: schema.customerLoyalty.total_points_earned,
        tier_id: schema.customerLoyalty.tier_id,
        tier_name: schema.loyaltyTiers.name,
      })
      .from(schema.customerLoyalty)
      .leftJoin(
        schema.loyaltyTiers,
        eq(schema.customerLoyalty.tier_id, schema.loyaltyTiers.id),
      )
      .leftJoin(
        schema.loyaltyPrograms,
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
      )
      .where(eq(schema.customerLoyalty.customer_id, id));

    const loyaltyIds = loyaltyEnrollments.map((e) => e.id);
    const { inArray } = await import("drizzle-orm");

    // Loyalty transactions + reward redemptions hang off the enrollment rows.
    const [loyaltyTransactions, rewardRedemptions] = await Promise.all([
      loyaltyIds.length > 0
        ? db
            .select()
            .from(schema.loyaltyTransactions)
            .where(inArray(schema.loyaltyTransactions.customer_loyalty_id, loyaltyIds))
            .orderBy(desc(schema.loyaltyTransactions.created_at))
        : Promise.resolve([] as any[]),
      loyaltyIds.length > 0
        ? db
            .select()
            .from(schema.rewardRedemptions)
            .where(inArray(schema.rewardRedemptions.customer_loyalty_id, loyaltyIds))
            .orderBy(desc(schema.rewardRedemptions.redeemed_at))
        : Promise.resolve([] as any[]),
    ]);

    // Coupon redemptions, orders, and referrals reference the customer directly.
    const [couponRedemptions, orders, referralsAsReferrer, referralsAsReferee] =
      await Promise.all([
        db
          .select()
          .from(schema.couponRedemptions)
          .where(eq(schema.couponRedemptions.customer_id, id))
          .orderBy(desc(schema.couponRedemptions.redeemed_at)),
        db
          .select()
          .from(schema.orders)
          .where(
            and(
              eq(schema.orders.customer_id, id),
              eq(schema.orders.organization_id, tenant.organizationId),
            ),
          )
          .orderBy(desc(schema.orders.created_at)),
        db
          .select()
          .from(schema.referrals)
          .where(
            and(
              eq(schema.referrals.referrer_customer_id, id),
              eq(schema.referrals.organization_id, tenant.organizationId),
            ),
          )
          .orderBy(desc(schema.referrals.created_at)),
        db
          .select()
          .from(schema.referrals)
          .where(
            and(
              eq(schema.referrals.referee_customer_id, id),
              eq(schema.referrals.organization_id, tenant.organizationId),
            ),
          )
          .orderBy(desc(schema.referrals.created_at)),
      ]);

    return c.json({
      success: true,
      data: {
        exported_at: new Date().toISOString(),
        customer,
        loyaltyEnrollments,
        loyaltyTransactions,
        rewardRedemptions,
        couponRedemptions,
        orders,
        referrals: {
          asReferrer: referralsAsReferrer,
          asReferee: referralsAsReferee,
        },
      },
    });
  },
);

// POST /customers/:id/anonymize - Data-subject erasure (Ley 29733).
// Irreversibly scrubs PII while PRESERVING loyalty/transaction/order rows so
// aggregate analytics and program integrity are unaffected. Org-scoped; rejects
// a customer that has already been anonymized.
loyalty.post(
  "/customers/:id/anonymize",
  requirePermission("customers:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Must belong to this org; load anonymized_at to enforce idempotency guard.
    const [existing] = await db
      .select({
        id: schema.customers.id,
        anonymized_at: schema.customers.anonymized_at,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cliente no encontrado" } },
        404,
      );
    }

    if (existing.anonymized_at) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El cliente ya fue anonimizado" } },
        409,
      );
    }

    // Scrub every PII column; preserve loyalty/transaction/order rows untouched.
    const [anonymized] = await db
      .update(schema.customers)
      .set({
        name: "Cliente anónimo",
        email: null,
        phone: null,
        birth_date: null,
        referral_code: null,
        marketing_opt_in: false,
        consent_at: null,
        anonymized_at: new Date(),
      })
      .where(eq(schema.customers.id, id))
      .returning();

    return c.json({ success: true, data: anonymized });
  },
);

// ---------------------------------------------------------------------------
// PROGRAMS
// ---------------------------------------------------------------------------

// GET /programs - List loyalty programs for the org
loyalty.get("/programs", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const programs = await db
    .select()
    .from(schema.loyaltyPrograms)
    .where(eq(schema.loyaltyPrograms.organization_id, tenant.organizationId));

  // For each program, get tiers
  const result = [];
  for (const program of programs) {
    const tiers = await db
      .select()
      .from(schema.loyaltyTiers)
      .where(eq(schema.loyaltyTiers.program_id, program.id))
      .orderBy(schema.loyaltyTiers.min_points);
    result.push({ ...program, tiers });
  }

  return c.json({ success: true, data: result });
});

// POST /programs - Create loyalty program
loyalty.post(
  "/programs",
  requirePermission("loyalty:create"),
  zValidator("json", createLoyaltyProgramSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [program] = await db
      .insert(schema.loyaltyPrograms)
      .values({
        organization_id: tenant.organizationId,
        name: body.name,
        points_per_currency_unit: body.pointsPerCurrencyUnit,
        currency_per_point: body.currencyPerPoint,
        is_active: body.isActive,
      })
      .returning();

    // Create default tiers
    const defaultTiers = [
      { name: "Bronce", min_points: 0, multiplier: 100 },
      { name: "Plata", min_points: 500, multiplier: 110 },
      { name: "Oro", min_points: 2000, multiplier: 125 },
      { name: "Platino", min_points: 5000, multiplier: 150 },
    ];

    const tiers = await db
      .insert(schema.loyaltyTiers)
      .values(
        defaultTiers.map((t) => ({
          program_id: program.id,
          name: t.name,
          min_points: t.min_points,
          multiplier: t.multiplier,
          benefits: {},
        })),
      )
      .returning();

    return c.json({ success: true, data: { ...program, tiers } }, 201);
  },
);

// PATCH /programs/:id - Update program
loyalty.patch(
  "/programs/:id",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(255).optional(),
      pointsPerCurrencyUnit: z.number().int().min(1).optional(),
      currencyPerPoint: z.number().int().min(1).optional(),
      isActive: z.boolean().optional(),
      // null = points never expire; positive int = expire after N days.
      pointsExpireAfterDays: z.number().int().min(1).nullable().optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [existing] = await db
      .select()
      .from(schema.loyaltyPrograms)
      .where(
        and(
          eq(schema.loyaltyPrograms.id, id),
          eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Programa no encontrado" } },
        404,
      );
    }

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.pointsPerCurrencyUnit !== undefined) updates.points_per_currency_unit = body.pointsPerCurrencyUnit;
    if (body.currencyPerPoint !== undefined) updates.currency_per_point = body.currencyPerPoint;
    if (body.isActive !== undefined) updates.is_active = body.isActive;
    if (body.pointsExpireAfterDays !== undefined) updates.points_expire_after_days = body.pointsExpireAfterDays;

    // Single-active invariant: the DB has a partial unique index on
    // (organization_id) WHERE is_active. When activating this program, deactivate
    // the org's other active programs FIRST in the same transaction so the unique
    // index never sees two active rows mid-update.
    const updated = await db.transaction(async (tx) => {
      if (body.isActive === true) {
        await tx
          .update(schema.loyaltyPrograms)
          .set({ is_active: false })
          .where(
            and(
              eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
              eq(schema.loyaltyPrograms.is_active, true),
              sql`${schema.loyaltyPrograms.id} <> ${id}`,
            ),
          );
      }

      const [row] = await tx
        .update(schema.loyaltyPrograms)
        .set(updates)
        .where(eq(schema.loyaltyPrograms.id, id))
        .returning();
      return row;
    });

    return c.json({ success: true, data: updated });
  },
);

// DELETE /programs/:id - Delete program
loyalty.delete(
  "/programs/:id",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [existing] = await db
      .select()
      .from(schema.loyaltyPrograms)
      .where(
        and(
          eq(schema.loyaltyPrograms.id, id),
          eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Programa no encontrado" } },
        404,
      );
    }

    await db.delete(schema.loyaltyPrograms).where(eq(schema.loyaltyPrograms.id, id));
    return c.json({ success: true, data: { deleted: true } });
  },
);

// ---------------------------------------------------------------------------
// TIERS
// ---------------------------------------------------------------------------

// POST /tiers - Create tier for a program
loyalty.post(
  "/tiers",
  requirePermission("loyalty:create"),
  zValidator(
    "json",
    z.object({
      programId: z.string().uuid(),
      name: z.string().min(1).max(255),
      minPoints: z.number().int().min(0),
      multiplier: z.number().int().min(100),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Verify program belongs to org
    const [program] = await db
      .select({ id: schema.loyaltyPrograms.id })
      .from(schema.loyaltyPrograms)
      .where(
        and(
          eq(schema.loyaltyPrograms.id, body.programId),
          eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!program) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Programa no encontrado" } },
        404,
      );
    }

    const [tier] = await db
      .insert(schema.loyaltyTiers)
      .values({
        program_id: body.programId,
        name: body.name,
        min_points: body.minPoints,
        multiplier: body.multiplier,
        benefits: {},
      })
      .returning();

    return c.json({ success: true, data: tier }, 201);
  },
);

// PATCH /tiers/:id - Update tier
loyalty.patch(
  "/tiers/:id",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(255).optional(),
      minPoints: z.number().int().min(0).optional(),
      multiplier: z.number().int().min(100).optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Verify tier belongs to a program owned by this org
    const [tier] = await db
      .select({
        id: schema.loyaltyTiers.id,
        program_id: schema.loyaltyTiers.program_id,
      })
      .from(schema.loyaltyTiers)
      .innerJoin(
        schema.loyaltyPrograms,
        and(
          eq(schema.loyaltyTiers.program_id, schema.loyaltyPrograms.id),
          eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        ),
      )
      .where(eq(schema.loyaltyTiers.id, id))
      .limit(1);

    if (!tier) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Nivel no encontrado" } },
        404,
      );
    }

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.minPoints !== undefined) updates.min_points = body.minPoints;
    if (body.multiplier !== undefined) updates.multiplier = body.multiplier;

    const [updated] = await db
      .update(schema.loyaltyTiers)
      .set(updates)
      .where(eq(schema.loyaltyTiers.id, id))
      .returning();

    return c.json({ success: true, data: updated });
  },
);

// DELETE /tiers/:id - Delete tier
loyalty.delete(
  "/tiers/:id",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Verify tier belongs to a program owned by this org
    const [tier] = await db
      .select({ id: schema.loyaltyTiers.id })
      .from(schema.loyaltyTiers)
      .innerJoin(
        schema.loyaltyPrograms,
        and(
          eq(schema.loyaltyTiers.program_id, schema.loyaltyPrograms.id),
          eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        ),
      )
      .where(eq(schema.loyaltyTiers.id, id))
      .limit(1);

    if (!tier) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Nivel no encontrado" } },
        404,
      );
    }

    await db.delete(schema.loyaltyTiers).where(eq(schema.loyaltyTiers.id, id));
    return c.json({ success: true, data: { deleted: true } });
  },
);

// ---------------------------------------------------------------------------
// REWARDS
// ---------------------------------------------------------------------------

// GET /rewards - List all rewards for the org's program (admin sees all, not just active)
loyalty.get("/rewards", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const result = await db
    .select({
      id: schema.rewards.id,
      program_id: schema.rewards.program_id,
      name: schema.rewards.name,
      description: schema.rewards.description,
      points_cost: schema.rewards.points_cost,
      reward_type: schema.rewards.reward_type,
      discount_type: schema.rewards.discount_type,
      discount_value: schema.rewards.discount_value,
      menu_item_id: schema.rewards.menu_item_id,
      stock_remaining: schema.rewards.stock_remaining,
      max_per_customer: schema.rewards.max_per_customer,
      starts_at: schema.rewards.starts_at,
      expires_at: schema.rewards.expires_at,
      is_active: schema.rewards.is_active,
    })
    .from(schema.rewards)
    .innerJoin(
      schema.loyaltyPrograms,
      eq(schema.rewards.program_id, schema.loyaltyPrograms.id),
    )
    .where(eq(schema.loyaltyPrograms.organization_id, tenant.organizationId));

  return c.json({ success: true, data: result });
});

// Validate reward business rules. Returns an error string (code) or null if OK.
// `rewardType` defaults to "discount" when omitted.
function validateRewardRules(input: {
  rewardType?: "discount" | "free_item";
  discountType?: "percentage" | "fixed";
  discountValue?: number;
  menuItemId?: string | null;
}): { code: string; message: string } | null {
  const rewardType = input.rewardType ?? "discount";

  if (rewardType === "free_item") {
    if (!input.menuItemId) {
      return { code: "BAD_REQUEST", message: "Una recompensa de producto gratis requiere un producto del menú" };
    }
  }

  // Percentage discounts must be 1..100.
  if (input.discountType === "percentage" && input.discountValue !== undefined) {
    if (input.discountValue < 1 || input.discountValue > 100) {
      return { code: "BAD_REQUEST", message: "El descuento porcentual debe estar entre 1 y 100" };
    }
  }

  return null;
}

// Verify a menu item belongs to the org. Returns true if owned.
async function menuItemBelongsToOrg(menuItemId: string, organizationId: string): Promise<boolean> {
  const [item] = await db
    .select({ id: schema.menuItems.id })
    .from(schema.menuItems)
    .where(
      and(
        eq(schema.menuItems.id, menuItemId),
        eq(schema.menuItems.organization_id, organizationId),
      ),
    )
    .limit(1);
  return !!item;
}

// POST /rewards - Create reward
loyalty.post(
  "/rewards",
  requirePermission("loyalty:create"),
  zValidator(
    "json",
    z.object({
      programId: z.string().uuid(),
      name: z.string().min(1).max(255),
      description: z.string().max(500).optional(),
      pointsCost: z.number().int().min(1),
      rewardType: z.enum(["discount", "free_item"]).optional(),
      discountType: z.enum(["percentage", "fixed"]).optional(),
      discountValue: z.number().int().min(1).optional(),
      menuItemId: z.string().uuid().nullable().optional(),
      stockRemaining: z.number().int().min(0).nullable().optional(),
      maxPerCustomer: z.number().int().min(1).nullable().optional(),
      startsAt: z.string().datetime().nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const rewardType = body.rewardType ?? "discount";

    // A discount reward needs a discount type + value (the columns are NOT NULL).
    if (rewardType === "discount" && (body.discountType === undefined || body.discountValue === undefined)) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Una recompensa de descuento requiere tipo y valor de descuento" } },
        400,
      );
    }

    const ruleError = validateRewardRules({
      rewardType,
      discountType: body.discountType,
      discountValue: body.discountValue,
      menuItemId: body.menuItemId,
    });
    if (ruleError) {
      return c.json({ success: false, error: ruleError }, 400);
    }

    // Verify program belongs to org
    const [program] = await db
      .select({ id: schema.loyaltyPrograms.id })
      .from(schema.loyaltyPrograms)
      .where(
        and(
          eq(schema.loyaltyPrograms.id, body.programId),
          eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!program) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Programa no encontrado" } },
        404,
      );
    }

    // free_item: the menu item must belong to this org.
    if (rewardType === "free_item" && body.menuItemId) {
      const ok = await menuItemBelongsToOrg(body.menuItemId, tenant.organizationId);
      if (!ok) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "El producto del menú no pertenece a la organización" } },
          400,
        );
      }
    }

    // discount_type/discount_value are NOT NULL in the schema. For free_item rewards
    // (which carry no discount), default to a zero "fixed" discount.
    const discountType = body.discountType ?? "fixed";
    const discountValue = rewardType === "free_item" ? (body.discountValue ?? 0) : body.discountValue!;

    const [reward] = await db
      .insert(schema.rewards)
      .values({
        program_id: body.programId,
        name: body.name,
        description: body.description,
        points_cost: body.pointsCost,
        reward_type: rewardType,
        discount_type: discountType,
        discount_value: discountValue,
        menu_item_id: rewardType === "free_item" ? body.menuItemId ?? null : null,
        stock_remaining: body.stockRemaining ?? null,
        max_per_customer: body.maxPerCustomer ?? null,
        starts_at: body.startsAt ? new Date(body.startsAt) : null,
        expires_at: body.expiresAt ? new Date(body.expiresAt) : null,
      })
      .returning();

    return c.json({ success: true, data: reward }, 201);
  },
);

// PATCH /rewards/:id - Update reward
loyalty.patch(
  "/rewards/:id",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(500).optional(),
      pointsCost: z.number().int().min(1).optional(),
      rewardType: z.enum(["discount", "free_item"]).optional(),
      discountType: z.enum(["percentage", "fixed"]).optional(),
      discountValue: z.number().int().min(1).optional(),
      menuItemId: z.string().uuid().nullable().optional(),
      stockRemaining: z.number().int().min(0).nullable().optional(),
      maxPerCustomer: z.number().int().min(1).nullable().optional(),
      startsAt: z.string().datetime().nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Verify reward belongs to a program owned by this org (load current values
    // so rule validation can fall back to the stored reward_type/discount_type).
    const [reward] = await db
      .select({
        id: schema.rewards.id,
        reward_type: schema.rewards.reward_type,
        discount_type: schema.rewards.discount_type,
      })
      .from(schema.rewards)
      .innerJoin(
        schema.loyaltyPrograms,
        and(
          eq(schema.rewards.program_id, schema.loyaltyPrograms.id),
          eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        ),
      )
      .where(eq(schema.rewards.id, id))
      .limit(1);

    if (!reward) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Recompensa no encontrada" } },
        404,
      );
    }

    const effectiveRewardType = (body.rewardType ?? reward.reward_type) as "discount" | "free_item";
    const effectiveDiscountType = (body.discountType ?? reward.discount_type ?? undefined) as
      | "percentage"
      | "fixed"
      | undefined;

    const ruleError = validateRewardRules({
      rewardType: effectiveRewardType,
      discountType: effectiveDiscountType,
      discountValue: body.discountValue,
      // Only enforce the free_item-needs-menuItem rule when the type is changing to
      // free_item without supplying a menu item; otherwise the existing one stands.
      menuItemId: body.rewardType === "free_item" ? body.menuItemId : undefined,
    });
    // Allow free_item rule to be skipped when rewardType isn't being switched to it.
    if (ruleError && !(effectiveRewardType === "free_item" && body.rewardType === undefined)) {
      return c.json({ success: false, error: ruleError }, 400);
    }

    // free_item: validate ownership of any new menu item.
    if (body.menuItemId) {
      const ok = await menuItemBelongsToOrg(body.menuItemId, tenant.organizationId);
      if (!ok) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "El producto del menú no pertenece a la organización" } },
          400,
        );
      }
    }

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.pointsCost !== undefined) updates.points_cost = body.pointsCost;
    if (body.rewardType !== undefined) updates.reward_type = body.rewardType;
    if (body.discountType !== undefined) updates.discount_type = body.discountType;
    if (body.discountValue !== undefined) updates.discount_value = body.discountValue;
    if (body.menuItemId !== undefined) updates.menu_item_id = body.menuItemId;
    if (body.stockRemaining !== undefined) updates.stock_remaining = body.stockRemaining;
    if (body.maxPerCustomer !== undefined) updates.max_per_customer = body.maxPerCustomer;
    if (body.startsAt !== undefined) updates.starts_at = body.startsAt ? new Date(body.startsAt) : null;
    if (body.expiresAt !== undefined) updates.expires_at = body.expiresAt ? new Date(body.expiresAt) : null;
    if (body.isActive !== undefined) updates.is_active = body.isActive;

    const [updated] = await db
      .update(schema.rewards)
      .set(updates)
      .where(eq(schema.rewards.id, id))
      .returning();

    return c.json({ success: true, data: updated });
  },
);

// DELETE /rewards/:id - Delete reward (soft-delete via is_active=false if redemptions exist)
loyalty.delete(
  "/rewards/:id",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Verify reward belongs to a program owned by this org
    const [reward] = await db
      .select({ id: schema.rewards.id })
      .from(schema.rewards)
      .innerJoin(
        schema.loyaltyPrograms,
        and(
          eq(schema.rewards.program_id, schema.loyaltyPrograms.id),
          eq(schema.loyaltyPrograms.organization_id, tenant.organizationId),
        ),
      )
      .where(eq(schema.rewards.id, id))
      .limit(1);

    if (!reward) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Recompensa no encontrada" } },
        404,
      );
    }

    // Check if reward has redemptions — if so, soft-delete
    const [{ count: redemptionCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.rewardRedemptions)
      .where(eq(schema.rewardRedemptions.reward_id, id));

    if (redemptionCount > 0) {
      await db
        .update(schema.rewards)
        .set({ is_active: false })
        .where(eq(schema.rewards.id, id));
      return c.json({ success: true, data: { deleted: false, deactivated: true } });
    }

    await db.delete(schema.rewards).where(eq(schema.rewards.id, id));
    return c.json({ success: true, data: { deleted: true } });
  },
);

// POST /rewards/:id/redeem - Redeem a reward for a customer
loyalty.post(
  "/rewards/:id/redeem",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      customerLoyaltyId: z.string().uuid(),
      orderId: z.string().uuid().optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const { customerLoyaltyId, orderId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    try {
      const result = await redeemReward({
        rewardId: id,
        customerLoyaltyId,
        organizationId: tenant.organizationId,
        orderId,
      });
      return c.json({ success: true, data: result }, 201);
    } catch (err: any) {
      if (err.message === "REWARD_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Recompensa no encontrada" } },
          404,
        );
      }
      if (err.message === "LOYALTY_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Registro de lealtad no encontrado" } },
          404,
        );
      }
      if (err.message === "PROGRAM_MISMATCH") {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "La recompensa no pertenece al programa del cliente" } },
          400,
        );
      }
      if (err.message === "INSUFFICIENT_POINTS") {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "Puntos insuficientes" } },
          400,
        );
      }
      throw err;
    }
  },
);

export { loyalty };
