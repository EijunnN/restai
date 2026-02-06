import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { authMiddleware } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";

const orgs = new Hono<AppEnv>();

orgs.use("*", authMiddleware);

// GET / - List organizations (super_admin only)
orgs.get("/", requirePermission("org:read"), async (c) => {
  const user = c.get("user") as any;

  // Super admin can see all, org_admin only their own
  if (user.role === "super_admin") {
    const result = await db.select().from(schema.organizations);
    return c.json({ success: true, data: result });
  }

  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, user.org))
    .limit(1);

  return c.json({ success: true, data: [org] });
});

// GET /:id
orgs.get(
  "/:id",
  requirePermission("org:read"),
  zValidator("param", z.object({ id: z.string().uuid() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const user = c.get("user") as any;

    // Non-super admin can only access their own org
    if (user.role !== "super_admin" && user.org !== id) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Sin acceso a esta organización" } },
        403,
      );
    }

    const [org] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .limit(1);

    if (!org) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Organización no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: org });
  },
);

// PATCH /:id
orgs.patch(
  "/:id",
  requirePermission("org:update"),
  zValidator("param", z.object({ id: z.string().uuid() })),
  zValidator(
    "json",
    z.object({
      name: z.string().min(2).max(255).optional(),
      logo_url: z.string().url().optional().nullable(),
      settings: z.record(z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const user = c.get("user") as any;

    if (user.role !== "super_admin" && user.org !== id) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Sin acceso a esta organización" } },
        403,
      );
    }

    const [updated] = await db
      .update(schema.organizations)
      .set({ ...body, updated_at: new Date() })
      .where(eq(schema.organizations.id, id))
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Organización no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

export { orgs };
