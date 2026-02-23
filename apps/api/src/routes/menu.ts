import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createCategorySchema,
  updateCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  createModifierGroupSchema,
  createModifierSchema,
  updateModifierGroupSchema,
  updateModifierSchema,
  idParamSchema,
} from "@restai/validators";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";

const menu = new Hono<AppEnv>();

menu.use("*", authMiddleware);
menu.use("*", tenantMiddleware);
menu.use("*", requireBranch);

// --- Categories ---

// GET /categories
menu.get("/categories", requirePermission("menu:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const categories = await db
    .select()
    .from(schema.menuCategories)
    .where(
      and(
        eq(schema.menuCategories.branch_id, tenant.branchId),
        eq(schema.menuCategories.organization_id, tenant.organizationId),
      ),
    );

  return c.json({ success: true, data: categories });
});

// POST /categories
menu.post(
  "/categories",
  requirePermission("menu:create"),
  zValidator("json", createCategorySchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [category] = await db
      .insert(schema.menuCategories)
      .values({
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        name: body.name,
        description: body.description,
        image_url: body.imageUrl,
        sort_order: body.sortOrder,
        is_active: body.isActive,
      })
      .returning();

    return c.json({ success: true, data: category }, 201);
  },
);

// PATCH /categories/:id
menu.patch(
  "/categories/:id",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateCategorySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.imageUrl !== undefined) updateData.image_url = body.imageUrl;
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    const [updated] = await db
      .update(schema.menuCategories)
      .set(updateData)
      .where(
        and(
          eq(schema.menuCategories.id, id),
          eq(schema.menuCategories.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Categoría no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /categories/:id
menu.delete(
  "/categories/:id",
  requirePermission("menu:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [deleted] = await db
      .delete(schema.menuCategories)
      .where(
        and(
          eq(schema.menuCategories.id, id),
          eq(schema.menuCategories.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Categoría no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Categoría eliminada" } });
  },
);

// --- Items ---

// GET /items
menu.get("/items", requirePermission("menu:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const categoryId = c.req.query("categoryId");

  const conditions = [
    eq(schema.menuItems.branch_id, tenant.branchId),
    eq(schema.menuItems.organization_id, tenant.organizationId),
  ];

  if (categoryId) {
    conditions.push(eq(schema.menuItems.category_id, categoryId));
  }

  const items = await db
    .select()
    .from(schema.menuItems)
    .where(and(...conditions));

  return c.json({ success: true, data: items });
});

// POST /items
menu.post(
  "/items",
  requirePermission("menu:create"),
  zValidator("json", createMenuItemSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [category] = await db
      .select({ id: schema.menuCategories.id })
      .from(schema.menuCategories)
      .where(
        and(
          eq(schema.menuCategories.id, body.categoryId),
          eq(schema.menuCategories.branch_id, tenant.branchId),
          eq(schema.menuCategories.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!category) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Categoría no encontrada" } },
        404,
      );
    }

    const [item] = await db
      .insert(schema.menuItems)
      .values({
        category_id: body.categoryId,
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        name: body.name,
        description: body.description,
        price: body.price,
        image_url: body.imageUrl,
        is_available: body.isAvailable,
        sort_order: body.sortOrder,
        preparation_time_min: body.preparationTimeMin,
      })
      .returning();

    return c.json({ success: true, data: item }, 201);
  },
);

// PATCH /items/:id
menu.patch(
  "/items/:id",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateMenuItemSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.categoryId !== undefined) updateData.category_id = body.categoryId;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.imageUrl !== undefined) updateData.image_url = body.imageUrl;
    if (body.isAvailable !== undefined) updateData.is_available = body.isAvailable;
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;
    if (body.preparationTimeMin !== undefined) updateData.preparation_time_min = body.preparationTimeMin;

    const [updated] = await db
      .update(schema.menuItems)
      .set(updateData)
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /items/:id
menu.delete(
  "/items/:id",
  requirePermission("menu:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [deleted] = await db
      .delete(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Item eliminado" } });
  },
);

// --- Modifier Groups ---

// POST /modifier-groups
menu.post(
  "/modifier-groups",
  requirePermission("menu:create"),
  zValidator("json", createModifierGroupSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [group] = await db
      .insert(schema.modifierGroups)
      .values({
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        name: body.name,
        min_selections: body.minSelections,
        max_selections: body.maxSelections,
        is_required: body.isRequired,
      })
      .returning();

    return c.json({ success: true, data: group }, 201);
  },
);

// --- Modifiers ---

// POST /modifiers
menu.post(
  "/modifiers",
  requirePermission("menu:create"),
  zValidator("json", createModifierSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [group] = await db
      .select({ id: schema.modifierGroups.id })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, body.groupId),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!group) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    const [modifier] = await db
      .insert(schema.modifiers)
      .values({
        group_id: body.groupId,
        name: body.name,
        price: body.price,
        is_available: body.isAvailable,
      })
      .returning();

    return c.json({ success: true, data: modifier }, 201);
  },
);

// POST /items/:id/modifier-groups - Link modifier group to item
menu.post(
  "/items/:id/modifier-groups",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", z.object({ groupId: z.string().uuid() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { groupId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [item] = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    const [group] = await db
      .select({ id: schema.modifierGroups.id })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, groupId),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!item || !group) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item o grupo no encontrado" } },
        404,
      );
    }

    await db
      .insert(schema.menuItemModifierGroups)
      .values({ item_id: id, group_id: groupId })
      .onConflictDoNothing();

    return c.json({ success: true, data: { message: "Grupo de modificadores vinculado" } }, 201);
  },
);

// GET /modifier-groups
menu.get("/modifier-groups", requirePermission("menu:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const groups = await db
    .select()
    .from(schema.modifierGroups)
    .where(
      and(
        eq(schema.modifierGroups.branch_id, tenant.branchId),
        eq(schema.modifierGroups.organization_id, tenant.organizationId),
      ),
    );

  // Fetch modifiers for each group
  const groupIds = groups.map((g) => g.id);
  let allModifiers: any[] = [];
  if (groupIds.length > 0) {
    allModifiers = await db
      .select()
      .from(schema.modifiers)
      .where(
        groupIds.length === 1
          ? eq(schema.modifiers.group_id, groupIds[0])
          : inArray(schema.modifiers.group_id, groupIds)
      );
  }

  const result = groups.map((g) => ({
    ...g,
    modifiers: allModifiers.filter((m) => m.group_id === g.id),
  }));

  return c.json({ success: true, data: result });
});

// PATCH /modifier-groups/:id
menu.patch(
  "/modifier-groups/:id",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateModifierGroupSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.minSelections !== undefined) updateData.min_selections = body.minSelections;
    if (body.maxSelections !== undefined) updateData.max_selections = body.maxSelections;
    if (body.isRequired !== undefined) updateData.is_required = body.isRequired;

    const [updated] = await db
      .update(schema.modifierGroups)
      .set(updateData)
      .where(
        and(
          eq(schema.modifierGroups.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /modifier-groups/:id
menu.delete(
  "/modifier-groups/:id",
  requirePermission("menu:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [deleted] = await db
      .delete(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Grupo eliminado" } });
  },
);

// PATCH /modifiers/:id
menu.patch(
  "/modifiers/:id",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateModifierSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [existingModifier] = await db
      .select({
        id: schema.modifiers.id,
      })
      .from(schema.modifiers)
      .innerJoin(
        schema.modifierGroups,
        eq(schema.modifiers.group_id, schema.modifierGroups.id),
      )
      .where(
        and(
          eq(schema.modifiers.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existingModifier) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Modificador no encontrado" } },
        404,
      );
    }

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.isAvailable !== undefined) updateData.is_available = body.isAvailable;

    const [updated] = await db
      .update(schema.modifiers)
      .set(updateData)
      .where(eq(schema.modifiers.id, id))
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Modificador no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /modifiers/:id
menu.delete(
  "/modifiers/:id",
  requirePermission("menu:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [existingModifier] = await db
      .select({
        id: schema.modifiers.id,
      })
      .from(schema.modifiers)
      .innerJoin(
        schema.modifierGroups,
        eq(schema.modifiers.group_id, schema.modifierGroups.id),
      )
      .where(
        and(
          eq(schema.modifiers.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existingModifier) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Modificador no encontrado" } },
        404,
      );
    }

    const [deleted] = await db
      .delete(schema.modifiers)
      .where(eq(schema.modifiers.id, id))
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Modificador no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Modificador eliminado" } });
  },
);

// GET /items/:id/modifier-groups
menu.get(
  "/items/:id/modifier-groups",
  requirePermission("menu:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [item] = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!item) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    const links = await db
      .select()
      .from(schema.menuItemModifierGroups)
      .where(eq(schema.menuItemModifierGroups.item_id, id));

    if (links.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const groupIds = links.map((l) => l.group_id);
    const groups = await db
      .select()
      .from(schema.modifierGroups)
      .where(
        and(
          groupIds.length === 1
            ? eq(schema.modifierGroups.id, groupIds[0])
            : inArray(schema.modifierGroups.id, groupIds),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        )
      );

    // Also fetch modifiers for these groups
    let allModifiers: any[] = [];
    if (groupIds.length > 0) {
      allModifiers = await db
        .select()
        .from(schema.modifiers)
        .where(
          groupIds.length === 1
            ? eq(schema.modifiers.group_id, groupIds[0])
            : inArray(schema.modifiers.group_id, groupIds)
        );
    }

    const result = groups.map((g) => ({
      ...g,
      modifiers: allModifiers.filter((m) => m.group_id === g.id),
    }));

    return c.json({ success: true, data: result });
  },
);

// DELETE /items/:id/modifier-groups/:groupId
menu.delete(
  "/items/:id/modifier-groups/:groupId",
  requirePermission("menu:update"),
  async (c) => {
    const itemId = c.req.param("id");
    const groupId = c.req.param("groupId");
    const tenant = c.get("tenant") as any;

    const [item] = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, itemId),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    const [group] = await db
      .select({ id: schema.modifierGroups.id })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, groupId),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!item || !group) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item o grupo no encontrado" } },
        404,
      );
    }

    const [deleted] = await db
      .delete(schema.menuItemModifierGroups)
      .where(
        and(
          eq(schema.menuItemModifierGroups.item_id, itemId),
          eq(schema.menuItemModifierGroups.group_id, groupId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Vínculo no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Grupo desvinculado" } });
  },
);

export { menu };
