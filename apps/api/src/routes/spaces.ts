import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, asc } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { createSpaceSchema, updateSpaceSchema, idParamSchema } from "@restai/validators";
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

export { spaces };
