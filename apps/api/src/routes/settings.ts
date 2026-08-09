import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "@restai/db";
import { eq } from "drizzle-orm";
import { updateOrgSettingsSchema, updateBranchSettingsSchema } from "@restai/validators";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { auditFromContext } from "../lib/audit.js";

const settings = new Hono<AppEnv>();
settings.use("*", authMiddleware, tenantMiddleware);

/**
 * Fusiona ajustes jsonb preservando lo que no venga en el cuerpo.
 *
 * REEMPLAZAR el objeto entero (lo que hacía antes `/org`) borra en silencio
 * claves que escriben otros módulos: la configuración de referidos, las series
 * de SUNAT, los interruptores de sede. El usuario guarda "el nombre del local" y
 * se lleva por delante la configuración fiscal sin enterarse.
 */
function mergeSettings(
  current: unknown,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base = (current as Record<string, unknown>) ?? {};
  if (!incoming) return base;
  return { ...base, ...incoming };
}

// GET /org
//
// `settings:read` explícito: la configuración incluye datos fiscales y ajustes
// del negocio. Antes bastaba con estar autenticado, así que cualquier rol —
// incluido cocina— podía leerla entera.
settings.get("/org", requirePermission("settings:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const [org] = await db.select().from(schema.organizations)
    .where(eq(schema.organizations.id, tenant.organizationId));
  if (!org) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "Organización no encontrada" } }, 404);
  }
  return c.json({ success: true, data: org });
});

// PATCH /org
settings.patch("/org", requirePermission("org:update"), zValidator("json", updateOrgSettingsSchema), async (c) => {
  const tenant = c.get("tenant") as any;
  const body = c.req.valid("json");

  const [before] = await db
    .select({
      name: schema.organizations.name,
      logo_url: schema.organizations.logo_url,
      ruc: schema.organizations.ruc,
      legal_name: schema.organizations.legal_name,
      settings: schema.organizations.settings,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, tenant.organizationId))
    .limit(1);

  if (!before) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "Organización no encontrada" } }, 404);
  }

  const updateData: any = { updated_at: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.logoUrl !== undefined) updateData.logo_url = body.logoUrl;
  if (body.ruc !== undefined) updateData.ruc = body.ruc;
  if (body.legalName !== undefined) updateData.legal_name = body.legalName;
  if (body.settings !== undefined) {
    updateData.settings = mergeSettings(before.settings, body.settings);
  }

  const [updated] = await db.update(schema.organizations)
    .set(updateData)
    .where(eq(schema.organizations.id, tenant.organizationId))
    .returning();

  await auditFromContext(c, {
    action: "settings.update",
    entityType: "organization",
    entityId: tenant.organizationId,
    summary: "Actualización de datos de la organización",
    before,
    after: {
      name: updated.name,
      logo_url: updated.logo_url,
      ruc: updated.ruc,
      legal_name: updated.legal_name,
      settings: updated.settings,
    },
  });

  return c.json({ success: true, data: updated });
});

// GET /branch
settings.get("/branch", requirePermission("settings:read"), async (c) => {
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
settings.patch("/branch", requirePermission("branch:update"), zValidator("json", updateBranchSettingsSchema), async (c) => {
  const tenant = c.get("tenant") as any;
  if (!tenant.branchId) {
    return c.json({ success: false, error: { code: "BAD_REQUEST", message: "Branch ID requerido" } }, 400);
  }
  const body = c.req.valid("json");

  const [before] = await db
    .select({
      name: schema.branches.name,
      address: schema.branches.address,
      phone: schema.branches.phone,
      tax_rate: schema.branches.tax_rate,
      timezone: schema.branches.timezone,
      currency: schema.branches.currency,
      menu_mode: schema.branches.menu_mode,
      settings: schema.branches.settings,
    })
    .from(schema.branches)
    .where(eq(schema.branches.id, tenant.branchId))
    .limit(1);

  if (!before) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sede no encontrada" } }, 404);
  }

  const updateData: any = { updated_at: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.taxRate !== undefined) updateData.tax_rate = body.taxRate;
  if (body.timezone !== undefined) updateData.timezone = body.timezone;
  if (body.currency !== undefined) updateData.currency = body.currency;
  // Columna propia, no clave del jsonb: se escribe directa y no pasa por la
  // fusión superficial de `settings`, que puede perder claves.
  if (body.menuMode !== undefined) updateData.menu_mode = body.menuMode;

  // Un solo camino de escritura para los ajustes: primero se fusiona lo libre,
  // después se aplican los interruptores con nombre. Antes eran dos ramas y la
  // primera (`settings` a pelo) machacaba las claves de otros módulos, incluidas
  // las series de SUNAT que viven aquí.
  const hasToggles =
    body.inventoryEnabled !== undefined || body.waiterTableAssignmentEnabled !== undefined;

  if (body.settings !== undefined || hasToggles) {
    const merged = mergeSettings(before.settings, body.settings);
    if (body.inventoryEnabled !== undefined) merged.inventory_enabled = body.inventoryEnabled;
    if (body.waiterTableAssignmentEnabled !== undefined) {
      merged.waiter_table_assignment_enabled = body.waiterTableAssignmentEnabled;
    }
    updateData.settings = merged;
  }

  const [updated] = await db.update(schema.branches)
    .set(updateData)
    .where(eq(schema.branches.id, tenant.branchId))
    .returning();

  await auditFromContext(c, {
    action: "settings.update",
    entityType: "branch",
    entityId: tenant.branchId,
    // El IGV es el dato más sensible de esta pantalla: se destaca en el resumen
    // para que salte a la vista en la traza.
    summary:
      body.taxRate !== undefined && body.taxRate !== before.tax_rate
        ? `Cambio de IGV: ${(before.tax_rate / 100).toFixed(2)}% → ${(body.taxRate / 100).toFixed(2)}%`
        : body.menuMode !== undefined && body.menuMode !== before.menu_mode
          ? body.menuMode === "static"
            ? "La carta pasa a solo lectura: el QR deja de admitir pedidos"
            : "La carta vuelve a admitir pedidos desde la mesa"
          : "Actualización de la configuración de la sede",
    before,
    after: {
      name: updated.name,
      address: updated.address,
      phone: updated.phone,
      tax_rate: updated.tax_rate,
      timezone: updated.timezone,
      currency: updated.currency,
      menu_mode: updated.menu_mode,
      settings: updated.settings,
    },
  });

  return c.json({ success: true, data: updated });
});

export { settings };
