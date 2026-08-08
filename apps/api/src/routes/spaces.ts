import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, asc } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { createSpaceSchema, updateSpaceSchema, idParamSchema } from "@restai/validators";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";

const spaces = new Hono<AppEnv>();

spaces.use("*", authMiddleware);
spaces.use("*", tenantMiddleware);
spaces.use("*", requireBranch);

// GET / - List spaces for branch
spaces.get("/", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const result = await db
    .select()
    .from(schema.spaces)
    .where(
      and(
        eq(schema.spaces.branch_id, tenant.branchId),
        eq(schema.spaces.organization_id, tenant.organizationId),
      ),
    )
    .orderBy(asc(schema.spaces.sort_order));

  return c.json({ success: true, data: result });
});

// POST / - Create space
spaces.post(
  "/",
  requirePermission("tables:create"),
  zValidator("json", createSpaceSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [space] = await db
      .insert(schema.spaces)
      .values({
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        name: body.name,
        description: body.description,
        floor_number: body.floorNumber,
        sort_order: body.sortOrder,
        is_active: body.isActive,
      })
      .returning();

    return c.json({ success: true, data: space }, 201);
  },
);

// PATCH /:id - Update space
spaces.patch(
  "/:id",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateSpaceSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.floorNumber !== undefined) updateData.floor_number = body.floorNumber;
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    const [updated] = await db
      .update(schema.spaces)
      .set(updateData)
      .where(
        and(
          eq(schema.spaces.id, id),
          eq(schema.spaces.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Espacio no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /:id - Delete space (only if no tables)
spaces.delete(
  "/:id",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Check for tables in this space
    const tablesInSpace = await db
      .select({ id: schema.tables.id })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.space_id, id),
          eq(schema.tables.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (tablesInSpace.length > 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "No se puede eliminar un espacio que tiene mesas asignadas",
          },
        },
        400,
      );
    }

    const [deleted] = await db
      .delete(schema.spaces)
      .where(
        and(
          eq(schema.spaces.id, id),
          eq(schema.spaces.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Espacio no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: deleted });
  },
);

// ---------------------------------------------------------------------------
// Mobiliario del plano
// ---------------------------------------------------------------------------

/**
 * Cocina, barra, escalera, baños, entrada.
 *
 * Va bajo `tables:layout` y no bajo `tables:update`: colocar el mobiliario es
 * dibujar el local, la misma clase de acción que mover una mesa por el plano.
 * Un mozo trabaja la sala, no la redistribuye.
 *
 * Leerlo, en cambio, solo exige `tables:read`: quien puede ver las mesas tiene
 * que poder ver dónde está la cocina, o el plano no significa nada.
 */

const FIXTURE_KINDS = [
  "kitchen",
  "bar",
  "stairs",
  "restroom",
  "entrance",
  "wall",
  "plant",
  "other",
] as const;

const fixtureBodySchema = z.object({
  spaceId: z.string().uuid(),
  kind: z.enum(FIXTURE_KINDS),
  label: z.string().trim().max(60).optional(),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(1).max(2000),
  height: z.number().int().min(1).max(2000),
  rotation: z.number().int().optional(),
});

const fixturePatchSchema = fixtureBodySchema.partial().omit({ spaceId: true });

/** Normaliza el giro a [0, 360): el editor manda 360 y -15 con naturalidad. */
const normalizeRotation = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

// GET /fixtures?spaceId= — mobiliario de un espacio (o de toda la sede)
spaces.get("/fixtures", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const spaceId = c.req.query("spaceId");

  const conditions = [
    eq(schema.spaceFixtures.branch_id, tenant.branchId),
    eq(schema.spaceFixtures.organization_id, tenant.organizationId),
  ];
  if (spaceId) conditions.push(eq(schema.spaceFixtures.space_id, spaceId));

  const result = await db
    .select()
    .from(schema.spaceFixtures)
    .where(and(...conditions))
    .orderBy(asc(schema.spaceFixtures.created_at));

  return c.json({ success: true, data: result });
});

// POST /fixtures — coloca un elemento en el plano
spaces.post(
  "/fixtures",
  requirePermission("tables:layout"),
  zValidator("json", fixtureBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // El espacio tiene que ser de esta sede: sin esta comprobación se podría
    // colgar mobiliario del plano de otro cliente pasando su uuid.
    const [space] = await db
      .select({ id: schema.spaces.id })
      .from(schema.spaces)
      .where(
        and(
          eq(schema.spaces.id, body.spaceId),
          eq(schema.spaces.branch_id, tenant.branchId),
          eq(schema.spaces.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!space) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Espacio no encontrado" } },
        400,
      );
    }

    const [created] = await db
      .insert(schema.spaceFixtures)
      .values({
        space_id: body.spaceId,
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        kind: body.kind,
        label: body.label || null,
        position_x: body.x,
        position_y: body.y,
        width: body.width,
        height: body.height,
        rotation: normalizeRotation(body.rotation ?? 0),
      })
      .returning();

    return c.json({ success: true, data: created }, 201);
  },
);

// PATCH /fixtures/:id — mover, redimensionar o rotular
spaces.patch(
  "/fixtures/:id",
  requirePermission("tables:layout"),
  zValidator("param", idParamSchema),
  zValidator("json", fixturePatchSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [updated] = await db
      .update(schema.spaceFixtures)
      .set({
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.label !== undefined ? { label: body.label || null } : {}),
        ...(body.x !== undefined ? { position_x: body.x } : {}),
        ...(body.y !== undefined ? { position_y: body.y } : {}),
        ...(body.width !== undefined ? { width: body.width } : {}),
        ...(body.height !== undefined ? { height: body.height } : {}),
        ...(body.rotation !== undefined
          ? { rotation: normalizeRotation(body.rotation) }
          : {}),
      })
      .where(
        and(
          eq(schema.spaceFixtures.id, id),
          eq(schema.spaceFixtures.branch_id, tenant.branchId),
          eq(schema.spaceFixtures.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Elemento no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /fixtures/:id
spaces.delete(
  "/fixtures/:id",
  requirePermission("tables:layout"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [deleted] = await db
      .delete(schema.spaceFixtures)
      .where(
        and(
          eq(schema.spaceFixtures.id, id),
          eq(schema.spaceFixtures.branch_id, tenant.branchId),
          eq(schema.spaceFixtures.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Elemento no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: deleted });
  },
);

export { spaces };
