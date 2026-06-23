import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";

const campaigns = new Hono<AppEnv>();

campaigns.use("*", authMiddleware);
campaigns.use("*", tenantMiddleware);

// "HH:MM" 24h Lima time-of-day, e.g. "09:00" or "23:59".
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:MM)");

const idParam = z.object({ id: z.string().uuid() });

const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).default("draft"),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  multiplier: z.number().int().min(0).default(100),
  bonusPoints: z.number().int().min(0).default(0),
  tierId: z.string().uuid().optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startTime: hhmm.nullable().optional(),
  endTime: hhmm.nullable().optional(),
  multiplier: z.number().int().min(0).optional(),
  bonusPoints: z.number().int().min(0).optional(),
  tierId: z.string().uuid().nullable().optional(),
});

// GET / - List campaigns for org
campaigns.get("/", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const data = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.organization_id, tenant.organizationId))
    .orderBy(desc(schema.campaigns.created_at));

  return c.json({ success: true, data });
});

// POST / - Create campaign
campaigns.post(
  "/",
  requirePermission("loyalty:create"),
  zValidator("json", createCampaignSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        organization_id: tenant.organizationId,
        name: body.name,
        description: body.description ?? null,
        status: body.status,
        starts_at: body.startsAt ? new Date(body.startsAt) : null,
        ends_at: body.endsAt ? new Date(body.endsAt) : null,
        days_of_week: body.daysOfWeek,
        start_time: body.startTime ?? null,
        end_time: body.endTime ?? null,
        multiplier: body.multiplier,
        bonus_points: body.bonusPoints,
        tier_id: body.tierId ?? null,
      })
      .returning();

    return c.json({ success: true, data: campaign }, 201);
  },
);

// PATCH /:id - Update campaign
campaigns.patch(
  "/:id",
  requirePermission("loyalty:update"),
  zValidator("param", idParam),
  zValidator("json", updateCampaignSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [existing] = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, id),
          eq(schema.campaigns.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Campaña no encontrada" } },
        404,
      );
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    if (body.startsAt !== undefined)
      updates.starts_at = body.startsAt ? new Date(body.startsAt) : null;
    if (body.endsAt !== undefined)
      updates.ends_at = body.endsAt ? new Date(body.endsAt) : null;
    if (body.daysOfWeek !== undefined) updates.days_of_week = body.daysOfWeek;
    if (body.startTime !== undefined) updates.start_time = body.startTime;
    if (body.endTime !== undefined) updates.end_time = body.endTime;
    if (body.multiplier !== undefined) updates.multiplier = body.multiplier;
    if (body.bonusPoints !== undefined) updates.bonus_points = body.bonusPoints;
    if (body.tierId !== undefined) updates.tier_id = body.tierId;

    const [updated] = await db
      .update(schema.campaigns)
      .set(updates)
      .where(
        and(
          eq(schema.campaigns.id, id),
          eq(schema.campaigns.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    return c.json({ success: true, data: updated });
  },
);

// DELETE /:id - Delete campaign
campaigns.delete(
  "/:id",
  requirePermission("loyalty:update"),
  zValidator("param", idParam),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [existing] = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, id),
          eq(schema.campaigns.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Campaña no encontrada" } },
        404,
      );
    }

    await db
      .delete(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, id),
          eq(schema.campaigns.organization_id, tenant.organizationId),
        ),
      );

    return c.json({ success: true, data: { deleted: true } });
  },
);

export { campaigns };
