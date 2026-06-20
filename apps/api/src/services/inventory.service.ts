import { eq, and, sql, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";

/**
 * Records an inventory movement and updates the item's stock accordingly.
 * Returns the created movement record.
 * Throws if the inventory item is not found.
 */
export async function recordMovement(params: {
  itemId: string;
  type: "purchase" | "consumption" | "waste" | "adjustment";
  quantity: number;
  reference?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}): Promise<typeof schema.inventoryMovements.$inferSelect> {
  const { itemId, type, quantity, reference, notes, createdBy } = params;

  return await db.transaction(async (tx) => {
    // Read inside transaction with row lock
    const [item] = await tx
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, itemId))
      .limit(1)
      .for("update");

    if (!item) {
      throw new InventoryItemNotFoundError(`Item no encontrado: ${itemId}`);
    }

    // The validator enforces quantity > 0, so the sign is determined purely by
    // the movement type. purchase/adjustment add stock; consumption/waste remove it.
    const isDecreasing = type === "consumption" || type === "waste";

    // For stock-decreasing movements, re-check sufficiency against the locked
    // row before recording anything so concurrent deductions can't drive stock
    // negative (the FOR UPDATE lock serializes competing decrements).
    if (isDecreasing) {
      const available = parseFloat(item.current_stock);
      if (available < quantity) {
        throw new InsufficientStockError(item.name, quantity, available);
      }
    }

    const [movement] = await tx
      .insert(schema.inventoryMovements)
      .values({
        item_id: itemId,
        type,
        quantity: String(quantity),
        reference: reference || null,
        notes: notes || null,
        created_by: createdBy || null,
      })
      .returning();

    // Atomic stock update using SQL
    if (isDecreasing) {
      await tx.update(schema.inventoryItems).set({
        current_stock: sql`${schema.inventoryItems.current_stock}::numeric - ${quantity}`,
      }).where(eq(schema.inventoryItems.id, itemId));
    } else {
      await tx.update(schema.inventoryItems).set({
        current_stock: sql`${schema.inventoryItems.current_stock}::numeric + ${quantity}`,
      }).where(eq(schema.inventoryItems.id, itemId));
    }

    return movement;
  });
}

/**
 * Auto-deducts inventory for a completed order based on recipe ingredients.
 * Checks if inventory tracking is enabled for the branch.
 * Marks the order as inventory_deducted to prevent double deduction.
 * Uses FOR UPDATE locks and conditional updates to prevent negative stock.
 */
export async function deductForOrder(params: {
  orderId: string;
  orderNumber: string;
  branchId: string;
}): Promise<void> {
  const { orderId, orderNumber, branchId } = params;

  // Check if inventory is enabled for this branch
  const [branchSettings] = await db
    .select({ settings: schema.branches.settings })
    .from(schema.branches)
    .where(eq(schema.branches.id, branchId))
    .limit(1);

  const inventoryEnabled = (branchSettings?.settings as any)?.inventory_enabled;

  if (!inventoryEnabled) {
    return;
  }

  const orderItemsList = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.order_id, orderId));

  // Wrap all deductions + flag in a transaction
  await db.transaction(async (tx) => {
    // Lock the order row and compare-and-set on inventory_deducted to make
    // this idempotent regardless of any caller-supplied flag. If another
    // concurrent completion already deducted (or is mid-flight holding the
    // lock), we early-return after acquiring the lock and seeing the flag set.
    const [orderRow] = await tx
      .select({ inventory_deducted: schema.orders.inventory_deducted })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1)
      .for("update");

    if (!orderRow) {
      throw new InventoryItemNotFoundError(`Orden no encontrada: ${orderId}`);
    }

    if (orderRow.inventory_deducted) {
      // Already deducted by a prior (or concurrent, now-committed) completion.
      return;
    }

    // Collect all needed inventory item IDs first
    const deductions: Array<{
      inventoryItemId: string;
      deductQty: number;
      orderItemName: string;
      orderItemQty: number;
    }> = [];

    for (const orderItem of orderItemsList) {
      const ingredients = await tx
        .select()
        .from(schema.recipeIngredients)
        .where(eq(schema.recipeIngredients.menu_item_id, orderItem.menu_item_id));

      for (const ingredient of ingredients) {
        deductions.push({
          inventoryItemId: ingredient.inventory_item_id,
          deductQty: parseFloat(ingredient.quantity_used) * orderItem.quantity,
          orderItemName: orderItem.name,
          orderItemQty: orderItem.quantity,
        });
      }
    }

    if (deductions.length === 0) {
      await tx
        .update(schema.orders)
        .set({ inventory_deducted: true })
        .where(eq(schema.orders.id, orderId));
      return;
    }

    // Lock all needed inventory items with FOR UPDATE to prevent concurrent modifications.
    // Defense-in-depth: scope to the order's branch so a recipe pointing at an
    // inventory item from another branch is excluded here and trips the
    // "not found" guard below rather than silently deducting cross-tenant stock.
    const inventoryItemIds = [...new Set(deductions.map((d) => d.inventoryItemId))];
    const lockedItems = await tx
      .select()
      .from(schema.inventoryItems)
      .where(
        and(
          inArray(schema.inventoryItems.id, inventoryItemIds),
          eq(schema.inventoryItems.branch_id, branchId),
        ),
      )
      .for("update");

    const stockMap = new Map(lockedItems.map((item) => [item.id, parseFloat(item.current_stock)]));

    // Validate sufficient stock for all deductions
    const aggregated = new Map<string, number>();
    for (const d of deductions) {
      aggregated.set(d.inventoryItemId, (aggregated.get(d.inventoryItemId) || 0) + d.deductQty);
    }

    for (const [itemId, totalQty] of aggregated) {
      const available = stockMap.get(itemId);
      if (available === undefined) {
        const item = lockedItems.find((i) => i.id === itemId);
        throw new InventoryItemNotFoundError(`Item de inventario no encontrado: ${item?.name || itemId}`);
      }
      if (available < totalQty) {
        const item = lockedItems.find((i) => i.id === itemId);
        throw new InsufficientStockError(
          item?.name || itemId,
          totalQty,
          available,
        );
      }
    }

    // Apply deductions (stock validated above, rows locked)
    for (const d of deductions) {
      await tx
        .update(schema.inventoryItems)
        .set({
          current_stock: sql`${schema.inventoryItems.current_stock}::numeric - ${d.deductQty}`,
        })
        .where(eq(schema.inventoryItems.id, d.inventoryItemId));

      await tx
        .insert(schema.inventoryMovements)
        .values({
          item_id: d.inventoryItemId,
          type: "consumption",
          quantity: String(d.deductQty),
          reference: orderNumber,
          notes: `Auto-consumo: ${d.orderItemName} x${d.orderItemQty}`,
        });
    }

    await tx
      .update(schema.orders)
      .set({ inventory_deducted: true })
      .where(eq(schema.orders.id, orderId));
  });
}

/**
 * Custom error for when an inventory item is not found.
 */
export class InventoryItemNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryItemNotFoundError";
  }
}

/**
 * Custom error for insufficient stock.
 */
export class InsufficientStockError extends Error {
  constructor(
    public itemName: string,
    public required: number,
    public available: number,
  ) {
    super(`Stock insuficiente para "${itemName}": necesario ${required}, disponible ${available}`);
    this.name = "InsufficientStockError";
  }
}
