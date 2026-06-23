import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, or, lt, gte, isNull, desc, sql } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { idParamSchema, couponQuerySchema, createCouponSchema, updateCouponSchema } from "@restai/validators";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";

const coupons = new Hono<AppEnv>();

// Peru is always UTC-5 (no DST). Offset string for date-only parsing.
const PERU_TZ_OFFSET = "-05:00";

/**
 * Parse an incoming date string for storage.
 * - Date-only strings ("YYYY-MM-DD") are interpreted in America/Lima (UTC-5).
 *   `boundary="start"` -> 00:00:00 Lima; `boundary="end"` -> 23:59:59.999 Lima
 *   (inclusive end-of-day, so a coupon expiring "2026-06-22" is valid through
 *   the whole Lima day, not UTC midnight which would expire it a day early).
 * - Full ISO strings (with time/offset) are parsed as-is.
 * Returns null for empty/invalid input.
 */
function parseCouponDate(
  value: string | null | undefined,
  boundary: "start" | "end",
): Date | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (dateOnly) {
    const iso =
      boundary === "start"
        ? `${value}T00:00:00.000${PERU_TZ_OFFSET}`
        : `${value}T23:59:59.999${PERU_TZ_OFFSET}`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Derive whether a coupon is effectively expired at `now`, regardless of its
 * stored status (a coupon whose expires_at has passed is expired even if the
 * stored status still says "active").
 */
function isEffectivelyExpired(
  coupon: { status: string; expires_at: Date | null },
  now: Date,
): boolean {
  if (coupon.status === "expired") return true;
  return coupon.expires_at != null && coupon.expires_at < now;
}

// Unambiguous uppercase alphabet for generated codes — excludes easily-confused
// characters (0/O, 1/I) so printed/handed-out single-use codes are readable.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Generate a random uppercase suffix of `length` chars from CODE_ALPHABET. */
function randomCodeSuffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

coupons.use("*", authMiddleware);
coupons.use("*", tenantMiddleware);

// GET / - List coupons for org
coupons.get("/", requirePermission("loyalty:read"), zValidator("query", couponQuerySchema), async (c) => {
  const tenant = c.get("tenant") as any;
  const { status: statusFilter, type: typeFilter } = c.req.valid("query");
  // `batchId` is an additive, optional filter read from the raw query (it is not
  // part of couponQuerySchema, which strips unknown keys). When present and a
  // valid uuid, scope the list to a single bulk batch.
  const batchIdRaw = c.req.query("batchId");
  const batchId =
    batchIdRaw && z.string().uuid().safeParse(batchIdRaw).success
      ? batchIdRaw
      : null;
  const now = new Date();

  const conditions: any[] = [
    eq(schema.coupons.organization_id, tenant.organizationId),
  ];

  if (typeFilter) {
    conditions.push(eq(schema.coupons.type, typeFilter as any));
  }

  if (batchId) {
    conditions.push(eq(schema.coupons.batch_id, batchId));
  }

  // Status filtering is derived from expires_at at read time, not just the
  // stored status column. A coupon is "Expirado" when its expires_at has
  // passed (or status is explicitly "expired"), regardless of stored status.
  if (statusFilter === "expired") {
    conditions.push(
      or(
        eq(schema.coupons.status, "expired"),
        lt(schema.coupons.expires_at, now),
      ),
    );
  } else if (statusFilter === "active") {
    // Stored active AND not effectively expired (no expiry or expiry in future).
    conditions.push(
      eq(schema.coupons.status, "active"),
      or(isNull(schema.coupons.expires_at), gte(schema.coupons.expires_at, now)),
    );
  } else if (statusFilter === "inactive") {
    // Stored inactive AND not effectively expired (expired takes precedence).
    conditions.push(
      eq(schema.coupons.status, "inactive"),
      or(isNull(schema.coupons.expires_at), gte(schema.coupons.expires_at, now)),
    );
  }

  const result = await db
    .select()
    .from(schema.coupons)
    .where(and(...conditions))
    .orderBy(desc(schema.coupons.created_at));

  // Annotate each row with the read-time effective status so the UI can render
  // "Expirado" without relying on the (possibly stale) stored status.
  const data = result.map((coupon) => {
    const expired = isEffectivelyExpired(coupon, now);
    return {
      ...coupon,
      is_expired: expired,
      effective_status: expired ? "expired" : coupon.status,
    };
  });

  return c.json({ success: true, data });
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
        starts_at: parseCouponDate(body.startsAt, "start") ?? undefined,
        expires_at: parseCouponDate(body.expiresAt, "end") ?? undefined,
      })
      .returning();

    return c.json({ success: true, data: coupon }, 201);
  },
);

// POST /bulk - Generate a batch of single-use coupons in one transaction.
// Each coupon gets a unique PREFIX-XXXXXX code, max_uses_total = 1,
// max_uses_per_customer = 1, and shares one generated batch_id.
const bulkCouponSchema = z
  .object({
    count: z.number().int().min(1).max(1000),
    // Prefix is normalized to uppercase; allow A-Z/0-9/_/- only, up to 20 chars.
    prefix: z
      .string()
      .max(20)
      .regex(/^[A-Za-z0-9_-]*$/, "Prefijo invalido")
      .optional()
      .default(""),
    // Optional shared name/label. When omitted, each coupon is named after its
    // generated code (the column is NOT NULL). The frontend bulk dialog does not
    // currently send a name, so it must remain optional.
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(500).optional(),
    type: z.enum([
      "percentage",
      "fixed",
      "item_free",
      "item_discount",
      "category_discount",
      "buy_x_get_y",
    ]),
    discountValue: z.number().int().min(0).optional(),
    menuItemId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    buyQuantity: z.number().int().min(1).optional(),
    getQuantity: z.number().int().min(1).optional(),
    minOrderAmount: z.number().int().min(0).optional(),
    maxDiscountAmount: z.number().int().min(0).optional(),
    startsAt: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.type === "percentage" &&
      data.discountValue != null &&
      data.discountValue > 100
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "El porcentaje no puede ser mayor a 100",
      });
    }
  });

coupons.post(
  "/bulk",
  requirePermission("loyalty:create"),
  zValidator("json", bulkCouponSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const batchId = randomUUID();
    const prefix = body.prefix.toUpperCase();
    // PREFIX-XXXXXX; bare "XXXXXX" when no prefix supplied.
    const buildCode = () => {
      const suffix = randomCodeSuffix(6);
      return prefix ? `${prefix}-${suffix}` : suffix;
    };

    const startsAt = parseCouponDate(body.startsAt, "start") ?? undefined;
    const expiresAt = parseCouponDate(body.expiresAt, "end") ?? undefined;

    const baseValues = {
      organization_id: tenant.organizationId,
      description: body.description,
      type: body.type,
      discount_value: body.discountValue,
      menu_item_id: body.menuItemId,
      category_id: body.categoryId,
      buy_quantity: body.buyQuantity,
      get_quantity: body.getQuantity,
      min_order_amount: body.minOrderAmount,
      max_discount_amount: body.maxDiscountAmount,
      max_uses_total: 1,
      max_uses_per_customer: 1,
      batch_id: batchId,
      starts_at: startsAt,
      expires_at: expiresAt,
    };

    const codes: string[] = [];

    // Insert all coupons in a single transaction so no partial batch is ever
    // persisted (any throw rolls the whole batch back). Codes are inserted one
    // at a time with onConflictDoNothing on uq_coupons_org_code: a collision
    // yields no returned row (instead of a 23505 that would poison the tx), so
    // we simply retry that slot with a fresh suffix.
    await db.transaction(async (tx) => {
      // Track codes generated within this batch to avoid in-flight duplicates.
      const seen = new Set<string>();
      const MAX_ATTEMPTS = 10;

      for (let i = 0; i < body.count; i++) {
        let inserted = false;

        for (let attempt = 0; attempt < MAX_ATTEMPTS && !inserted; attempt++) {
          let code = buildCode();
          // Cheap in-memory dedupe before hitting the DB.
          let guard = 0;
          while (seen.has(code) && guard < MAX_ATTEMPTS) {
            code = buildCode();
            guard++;
          }

          const rows = await tx
            .insert(schema.coupons)
            .values({ ...baseValues, code, name: body.name ?? code })
            .onConflictDoNothing({
              target: [schema.coupons.organization_id, schema.coupons.code],
            })
            .returning({ id: schema.coupons.id });

          if (rows.length > 0) {
            seen.add(code);
            codes.push(code);
            inserted = true;
          }
        }

        if (!inserted) {
          throw new Error(
            "No se pudo generar un codigo unico para el lote",
          );
        }
      }
    });

    return c.json(
      { success: true, data: { batchId, count: codes.length, codes } },
      201,
    );
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
    if (body.startsAt !== undefined) updates.starts_at = parseCouponDate(body.startsAt, "start");
    if (body.expiresAt !== undefined) updates.expires_at = parseCouponDate(body.expiresAt, "end");

    const [updated] = await db
      .update(schema.coupons)
      .set(updates)
      .where(
        and(
          eq(schema.coupons.id, id),
          eq(schema.coupons.organization_id, tenant.organizationId),
        ),
      )
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

    await db
      .delete(schema.coupons)
      .where(
        and(
          eq(schema.coupons.id, id),
          eq(schema.coupons.organization_id, tenant.organizationId),
        ),
      );

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
    const tenant = c.get("tenant") as any;

    const [coupon] = await db
      .select({ id: schema.coupons.id })
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
