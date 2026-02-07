import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, lt, sql, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createInventoryItemSchema,
  createInventoryMovementSchema,
  idParamSchema,
  movementQuerySchema,
} from "@restai/validators";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { recordMovement, InventoryItemNotFoundError } from "../services/inventory.service.js";

const inventory = new Hono<AppEnv>();

inventory.use("*", authMiddleware);
inventory.use("*", tenantMiddleware);
inventory.use("*", requireBranch);

// --- Alerts ---

// GET /alerts - Items where current_stock < min_stock
inventory.get("/alerts", requirePermission("inventory:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const result = await db
    .select({
      id: schema.inventoryItems.id,
      name: schema.inventoryItems.name,
      unit: schema.inventoryItems.unit,
      current_stock: schema.inventoryItems.current_stock,
      min_stock: schema.inventoryItems.min_stock,
      cost_per_unit: schema.inventoryItems.cost_per_unit,
    })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.branch_id, tenant.branchId),
        eq(schema.inventoryItems.organization_id, tenant.organizationId),
        sql`${schema.inventoryItems.current_stock}::numeric < ${schema.inventoryItems.min_stock}::numeric`,
      ),
    );

  return c.json({ success: true, data: result });
});

// --- Recipes ---

// POST /recipes - Create/update recipe for a menu item
inventory.post(
  "/recipes",
  requirePermission("inventory:create"),
  zValidator(
    "json",
    z.object({
      menuItemId: z.string().uuid(),
      ingredients: z.array(
        z.object({
          inventoryItemId: z.string().uuid(),
          quantityUsed: z.number().positive(),
        }),
      ).min(1),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");

    // Delete existing recipe ingredients for this menu item
    await db
      .delete(schema.recipeIngredients)
      .where(eq(schema.recipeIngredients.menu_item_id, body.menuItemId));

    // Insert new recipe ingredients
    const values = body.ingredients.map((ing) => ({
      menu_item_id: body.menuItemId,
      inventory_item_id: ing.inventoryItemId,
      quantity_used: String(ing.quantityUsed),
    }));

    const result = await db
      .insert(schema.recipeIngredients)
      .values(values)
      .returning();

    return c.json({ success: true, data: result }, 201);
  },
);

// GET /recipes/:menuItemId - Get recipe ingredients for a menu item
inventory.get(
  "/recipes/:menuItemId",
  requirePermission("inventory:read"),
  zValidator("param", z.object({ menuItemId: z.string().uuid() })),
  async (c) => {
    const { menuItemId } = c.req.valid("param");

    const result = await db
      .select({
        menu_item_id: schema.recipeIngredients.menu_item_id,
        inventory_item_id: schema.recipeIngredients.inventory_item_id,
        quantity_used: schema.recipeIngredients.quantity_used,
        item_name: schema.inventoryItems.name,
        item_unit: schema.inventoryItems.unit,
        current_stock: schema.inventoryItems.current_stock,
      })
      .from(schema.recipeIngredients)
      .innerJoin(
        schema.inventoryItems,
        eq(schema.recipeIngredients.inventory_item_id, schema.inventoryItems.id),
      )
      .where(eq(schema.recipeIngredients.menu_item_id, menuItemId));

    return c.json({ success: true, data: result });
  },
);

// --- Items ---

// GET /items
inventory.get("/items", requirePermission("inventory:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const result = await db
    .select()
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.branch_id, tenant.branchId),
        eq(schema.inventoryItems.organization_id, tenant.organizationId),
      ),
    );

  return c.json({ success: true, data: result });
});

// POST /items
inventory.post(
  "/items",
  requirePermission("inventory:create"),
  zValidator("json", createInventoryItemSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [item] = await db
      .insert(schema.inventoryItems)
      .values({
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        category_id: body.categoryId,
        name: body.name,
        unit: body.unit,
        current_stock: String(body.currentStock),
        min_stock: String(body.minStock),
        cost_per_unit: body.costPerUnit,
      })
      .returning();

    return c.json({ success: true, data: item }, 201);
  },
);

// PATCH /items/:id
inventory.patch(
  "/items/:id",
  requirePermission("inventory:update"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(255).optional(),
      unit: z.string().min(1).max(50).optional(),
      minStock: z.number().min(0).optional(),
      costPerUnit: z.number().int().min(0).optional(),
      categoryId: z.string().uuid().optional().nullable(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.unit !== undefined) updateData.unit = body.unit;
    if (body.minStock !== undefined) updateData.min_stock = String(body.minStock);
    if (body.costPerUnit !== undefined) updateData.cost_per_unit = body.costPerUnit;
    if (body.categoryId !== undefined) updateData.category_id = body.categoryId;

    const [updated] = await db
      .update(schema.inventoryItems)
      .set(updateData)
      .where(
        and(
          eq(schema.inventoryItems.id, id),
          eq(schema.inventoryItems.branch_id, tenant.branchId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item de inventario no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// --- Movements ---

// POST /movements
inventory.post(
  "/movements",
  requirePermission("inventory:create"),
  zValidator("json", createInventoryMovementSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user") as any;

    try {
      const movement = await recordMovement({
        itemId: body.itemId,
        type: body.type,
        quantity: body.quantity,
        reference: body.reference,
        notes: body.notes,
        createdBy: user.sub,
      });

      return c.json({ success: true, data: movement }, 201);
    } catch (err) {
      if (err instanceof InventoryItemNotFoundError) {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
          404,
        );
      }
      throw err;
    }
  },
);

// GET /movements
inventory.get("/movements", requirePermission("inventory:read"), zValidator("query", movementQuerySchema), async (c) => {
  const tenant = c.get("tenant") as any;
  const { itemId } = c.req.valid("query");

  // Get items for this branch first
  const branchItems = await db
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.branch_id, tenant.branchId));

  const itemIds = branchItems.map((i) => i.id);
  if (itemIds.length === 0) {
    return c.json({ success: true, data: [] });
  }

  if (itemId) {
    const result = await db
      .select({
        id: schema.inventoryMovements.id,
        item_id: schema.inventoryMovements.item_id,
        type: schema.inventoryMovements.type,
        quantity: schema.inventoryMovements.quantity,
        reference: schema.inventoryMovements.reference,
        notes: schema.inventoryMovements.notes,
        created_at: schema.inventoryMovements.created_at,
        item_name: schema.inventoryItems.name,
      })
      .from(schema.inventoryMovements)
      .innerJoin(
        schema.inventoryItems,
        eq(schema.inventoryMovements.item_id, schema.inventoryItems.id),
      )
      .where(eq(schema.inventoryMovements.item_id, itemId))
      .orderBy(desc(schema.inventoryMovements.created_at))
      .limit(50);
    return c.json({ success: true, data: result });
  }

  // All movements for branch items
  const result = await db
    .select({
      id: schema.inventoryMovements.id,
      item_id: schema.inventoryMovements.item_id,
      type: schema.inventoryMovements.type,
      quantity: schema.inventoryMovements.quantity,
      reference: schema.inventoryMovements.reference,
      notes: schema.inventoryMovements.notes,
      created_at: schema.inventoryMovements.created_at,
      item_name: schema.inventoryItems.name,
    })
    .from(schema.inventoryMovements)
    .innerJoin(
      schema.inventoryItems,
      eq(schema.inventoryMovements.item_id, schema.inventoryItems.id),
    )
    .where(inArray(schema.inventoryMovements.item_id, itemIds))
    .orderBy(desc(schema.inventoryMovements.created_at))
    .limit(50);

  return c.json({ success: true, data: result });
});

// --- Categories ---

// GET /categories
inventory.get("/categories", requirePermission("inventory:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const result = await db
    .select()
    .from(schema.inventoryCategories)
    .where(
      and(
        eq(schema.inventoryCategories.branch_id, tenant.branchId),
        eq(schema.inventoryCategories.organization_id, tenant.organizationId),
      ),
    );

  return c.json({ success: true, data: result });
});

// POST /categories
inventory.post(
  "/categories",
  requirePermission("inventory:create"),
  zValidator("json", z.object({ name: z.string().min(1).max(255) })),
  async (c) => {
    const { name } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [category] = await db
      .insert(schema.inventoryCategories)
      .values({
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        name,
      })
      .returning();

    return c.json({ success: true, data: category }, 201);
  },
);

export { inventory };
