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
import { redeemReward } from "../services/loyalty.service.js";

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
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "20", 10);
    const offset = (page - 1) * limit;

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

    const transactions = await db
      .select()
      .from(schema.loyaltyTransactions)
      .where(inArray(schema.loyaltyTransactions.customer_loyalty_id, loyaltyIds))
      .orderBy(desc(schema.loyaltyTransactions.created_at))
      .limit(limit)
      .offset(offset);

    return c.json({
      success: true,
      data: transactions,
      pagination: { page, limit, total: transactions.length },
    });
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

    const [updated] = await db
      .update(schema.loyaltyPrograms)
      .set(updates)
      .where(eq(schema.loyaltyPrograms.id, id))
      .returning();

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
      discount_type: schema.rewards.discount_type,
      discount_value: schema.rewards.discount_value,
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
      discountType: z.enum(["percentage", "fixed"]),
      discountValue: z.number().int().min(1),
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

    const [reward] = await db
      .insert(schema.rewards)
      .values({
        program_id: body.programId,
        name: body.name,
        description: body.description,
        points_cost: body.pointsCost,
        discount_type: body.discountType,
        discount_value: body.discountValue,
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
      discountType: z.enum(["percentage", "fixed"]).optional(),
      discountValue: z.number().int().min(1).optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
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

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.pointsCost !== undefined) updates.points_cost = body.pointsCost;
    if (body.discountType !== undefined) updates.discount_type = body.discountType;
    if (body.discountValue !== undefined) updates.discount_value = body.discountValue;
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
