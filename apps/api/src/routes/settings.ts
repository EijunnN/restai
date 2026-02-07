import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { db, schema } from "@restai/db";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";

const settings = new Hono<AppEnv>();
settings.use("*", authMiddleware, tenantMiddleware);

// GET /org
settings.get("/org", async (c) => {
  const tenant = c.get("tenant") as any;
  const [org] = await db.select().from(schema.organizations)
    .where(eq(schema.organizations.id, tenant.organizationId));
  if (!org) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "Organizacion no encontrada" } }, 404);
  }
  return c.json({ success: true, data: org });
});

// PATCH /org
settings.patch("/org", requirePermission("org:update"), async (c) => {
  const tenant = c.get("tenant") as any;
  const body = await c.req.json();

  const updateData: any = { updated_at: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.logoUrl !== undefined) updateData.logo_url = body.logoUrl;
  if (body.settings !== undefined) updateData.settings = body.settings;

  const [updated] = await db.update(schema.organizations)
    .set(updateData)
    .where(eq(schema.organizations.id, tenant.organizationId))
    .returning();
  return c.json({ success: true, data: updated });
});

// GET /branch
settings.get("/branch", async (c) => {
  const tenant = c.get("tenant") as any;
  if (!tenant.branchId) {
    return c.json({ success: false, error: { code: "BAD_REQUEST", message: "Branch ID requerido" } }, 400);
  }
  const [branch] = await db.select().from(schema.branches)
    .where(eq(schema.branches.id, tenant.branchId));
  if (!branch) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sede no encontrada" } }, 404);
  }
  return c.json({ success: true, data: branch });
});

// PATCH /branch
settings.patch("/branch", requirePermission("settings:*"), async (c) => {
  const tenant = c.get("tenant") as any;
  if (!tenant.branchId) {
    return c.json({ success: false, error: { code: "BAD_REQUEST", message: "Branch ID requerido" } }, 400);
  }
  const body = await c.req.json();
  const updateData: any = { updated_at: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.taxRate !== undefined) updateData.tax_rate = body.taxRate;
  if (body.timezone !== undefined) updateData.timezone = body.timezone;
  if (body.currency !== undefined) updateData.currency = body.currency;
  if (body.settings !== undefined) updateData.settings = body.settings;

  if (body.inventoryEnabled !== undefined || body.waiterTableAssignmentEnabled !== undefined) {
    // Fetch current settings to merge
    const [existing] = await db.select({ settings: schema.branches.settings })
      .from(schema.branches)
      .where(eq(schema.branches.id, tenant.branchId))
      .limit(1);
    const currentSettings = (existing?.settings as Record<string, unknown>) || {};
    const merged = { ...currentSettings };
    if (body.inventoryEnabled !== undefined) merged.inventory_enabled = body.inventoryEnabled;
    if (body.waiterTableAssignmentEnabled !== undefined) merged.waiter_table_assignment_enabled = body.waiterTableAssignmentEnabled;
    updateData.settings = merged;
  }

  const [updated] = await db.update(schema.branches)
    .set(updateData)
    .where(eq(schema.branches.id, tenant.branchId))
    .returning();
  return c.json({ success: true, data: updated });
});

export { settings };
