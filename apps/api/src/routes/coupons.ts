import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { idParamSchema } from "@restai/validators";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";

const coupons = new Hono<AppEnv>();

coupons.use("*", authMiddleware);
coupons.use("*", tenantMiddleware);

const createCouponSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  type: z.enum(["percentage", "fixed", "item_free", "item_discount", "category_discount", "buy_x_get_y"]),
  discountValue: z.number().int().optional(),
  menuItemId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  buyQuantity: z.number().int().min(1).optional(),
  getQuantity: z.number().int().min(1).optional(),
  minOrderAmount: z.number().int().min(0).optional(),
  maxDiscountAmount: z.number().int().min(0).optional(),
  maxUsesTotal: z.number().int().min(1).optional(),
  maxUsesPerCustomer: z.number().int().min(1).optional(),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
});

const updateCouponSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["active", "inactive", "expired"]).optional(),
  discountValue: z.number().int().optional(),
  menuItemId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  buyQuantity: z.number().int().min(1).nullable().optional(),
  getQuantity: z.number().int().min(1).nullable().optional(),
  minOrderAmount: z.number().int().min(0).nullable().optional(),
  maxDiscountAmount: z.number().int().min(0).nullable().optional(),
  maxUsesTotal: z.number().int().min(1).nullable().optional(),
  maxUsesPerCustomer: z.number().int().min(1).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

// GET / - List coupons for org
coupons.get("/", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const statusFilter = c.req.query("status");
  const typeFilter = c.req.query("type");

  const conditions: any[] = [
    eq(schema.coupons.organization_id, tenant.organizationId),
  ];

  if (statusFilter && ["active", "inactive", "expired"].includes(statusFilter)) {
    conditions.push(eq(schema.coupons.status, statusFilter as any));
  }

  if (typeFilter && ["percentage", "fixed", "item_free", "item_discount", "category_discount", "buy_x_get_y"].includes(typeFilter)) {
    conditions.push(eq(schema.coupons.type, typeFilter as any));
  }

  const result = await db
    .select()
    .from(schema.coupons)
    .where(and(...conditions))
    .orderBy(desc(schema.coupons.created_at));

  return c.json({ success: true, data: result });
});

// POST / - Create coupon
coupons.post(
  "/",
  requirePermission("loyalty:create"),
  zValidator("json", createCouponSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Check code uniqueness within org
    const [existing] = await db
      .select({ id: schema.coupons.id })
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.organization_id, tenant.organizationId),
          eq(schema.coupons.code, body.code.toUpperCase()),
        ),
      )
      .limit(1);

    if (existing) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "Ya existe un cupon con este codigo" } },
        409,
      );
    }

    const [coupon] = await db
      .insert(schema.coupons)
      .values({
        organization_id: tenant.organizationId,
        code: body.code.toUpperCase(),
        name: body.name,
        description: body.description,
        type: body.type,
        discount_value: body.discountValue,
        menu_item_id: body.menuItemId,
        category_id: body.categoryId,
        buy_quantity: body.buyQuantity,
        get_quantity: body.getQuantity,
        min_order_amount: body.minOrderAmount,
        max_discount_amount: body.maxDiscountAmount,
        max_uses_total: body.maxUsesTotal,
        max_uses_per_customer: body.maxUsesPerCustomer,
        starts_at: body.startsAt ? new Date(body.startsAt) : undefined,
        expires_at: body.expiresAt ? new Date(body.expiresAt) : undefined,
      })
      .returning();

    return c.json({ success: true, data: coupon }, 201);
  },
);

// GET /:id - Get coupon by ID
coupons.get(
  "/:id",
  requirePermission("loyalty:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [coupon] = await db
      .select()
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.id, id),
          eq(schema.coupons.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!coupon) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cupon no encontrado" } },
        404,
      );
    }

    // Get redemption count
    const [redemptionData] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.couponRedemptions)
      .where(eq(schema.couponRedemptions.coupon_id, id));

    return c.json({
      success: true,
      data: { ...coupon, redemption_count: redemptionData?.count ?? 0 },
    });
  },
);

// PATCH /:id - Update coupon
coupons.patch(
  "/:id",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  zValidator("json", updateCouponSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [existing] = await db
      .select()
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.id, id),
          eq(schema.coupons.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cupon no encontrado" } },
        404,
      );
    }

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    if (body.discountValue !== undefined) updates.discount_value = body.discountValue;
    if (body.menuItemId !== undefined) updates.menu_item_id = body.menuItemId;
    if (body.categoryId !== undefined) updates.category_id = body.categoryId;
    if (body.buyQuantity !== undefined) updates.buy_quantity = body.buyQuantity;
    if (body.getQuantity !== undefined) updates.get_quantity = body.getQuantity;
    if (body.minOrderAmount !== undefined) updates.min_order_amount = body.minOrderAmount;
    if (body.maxDiscountAmount !== undefined) updates.max_discount_amount = body.maxDiscountAmount;
    if (body.maxUsesTotal !== undefined) updates.max_uses_total = body.maxUsesTotal;
    if (body.maxUsesPerCustomer !== undefined) updates.max_uses_per_customer = body.maxUsesPerCustomer;
    if (body.startsAt !== undefined) updates.starts_at = body.startsAt ? new Date(body.startsAt) : null;
    if (body.expiresAt !== undefined) updates.expires_at = body.expiresAt ? new Date(body.expiresAt) : null;

    const [updated] = await db
      .update(schema.coupons)
      .set(updates)
      .where(eq(schema.coupons.id, id))
      .returning();

    return c.json({ success: true, data: updated });
  },
);

// DELETE /:id - Delete coupon
coupons.delete(
  "/:id",
  requirePermission("loyalty:create"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [existing] = await db
      .select()
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.id, id),
          eq(schema.coupons.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cupon no encontrado" } },
        404,
      );
    }

    await db.delete(schema.coupons).where(eq(schema.coupons.id, id));

    return c.json({ success: true, data: { deleted: true } });
  },
);

// POST /validate - Validate a coupon code (check validity, return discount info)
coupons.post(
  "/validate",
  requirePermission("loyalty:read"),
  zValidator("json", z.object({ code: z.string().min(1) })),
  async (c) => {
    const { code } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [coupon] = await db
      .select()
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.organization_id, tenant.organizationId),
          eq(schema.coupons.code, code.toUpperCase()),
        ),
      )
      .limit(1);

    if (!coupon) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cupon no encontrado" } },
        404,
      );
    }

    if (coupon.status !== "active") {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon no esta activo" } },
        400,
      );
    }

    const now = new Date();
    if (coupon.starts_at && now < coupon.starts_at) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon aun no esta vigente" } },
        400,
      );
    }

    if (coupon.expires_at && now > coupon.expires_at) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon ha expirado" } },
        400,
      );
    }

    if (coupon.max_uses_total && coupon.current_uses >= coupon.max_uses_total) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon ha alcanzado el limite de usos" } },
        400,
      );
    }

    return c.json({
      success: true,
      data: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        type: coupon.type,
        discount_value: coupon.discount_value,
        menu_item_id: coupon.menu_item_id,
        category_id: coupon.category_id,
        buy_quantity: coupon.buy_quantity,
        get_quantity: coupon.get_quantity,
        min_order_amount: coupon.min_order_amount,
        max_discount_amount: coupon.max_discount_amount,
      },
    });
  },
);

// POST /assign - Assign coupon to customers (admin)
coupons.post(
  "/assign",
  requirePermission("loyalty:create"),
  zValidator(
    "json",
    z.object({
      couponId: z.string().uuid(),
      customerIds: z.array(z.string().uuid()).min(1).max(100),
    }),
  ),
  async (c) => {
    const { couponId, customerIds } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Verify coupon belongs to org
    const [coupon] = await db
      .select({ id: schema.coupons.id })
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.id, couponId),
          eq(schema.coupons.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!coupon) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cupon no encontrado" } },
        404,
      );
    }

    const values = customerIds.map((customerId) => ({
      coupon_id: couponId,
      customer_id: customerId,
    }));

    await db
      .insert(schema.couponAssignments)
      .values(values)
      .onConflictDoNothing();

    return c.json({ success: true, data: { assigned: customerIds.length } }, 201);
  },
);

// GET /:id/assignments - List assignments for a coupon (admin)
coupons.get(
  "/:id/assignments",
  requirePermission("loyalty:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");

    const assignments = await db
      .select({
        id: schema.couponAssignments.id,
        customer_id: schema.couponAssignments.customer_id,
        customer_name: schema.customers.name,
        customer_phone: schema.customers.phone,
        sent_at: schema.couponAssignments.sent_at,
        seen_at: schema.couponAssignments.seen_at,
        used_at: schema.couponAssignments.used_at,
      })
      .from(schema.couponAssignments)
      .leftJoin(
        schema.customers,
        eq(schema.couponAssignments.customer_id, schema.customers.id),
      )
      .where(eq(schema.couponAssignments.coupon_id, id));

    return c.json({ success: true, data: assignments });
  },
);

export { coupons };
