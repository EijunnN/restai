import { eq, sql } from "drizzle-orm";
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

  // Get current stock
  const [item] = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, itemId))
    .limit(1);

  if (!item) {
    throw new InventoryItemNotFoundError(`Item no encontrado: ${itemId}`);
  }

  const currentStock = parseFloat(item.current_stock);
  let newStock = currentStock;

  if (type === "purchase") {
    newStock += quantity;
  } else if (type === "consumption" || type === "waste") {
    newStock -= quantity;
  } else {
    // adjustment
    newStock += quantity;
  }

  // Create movement + update stock in a transaction
  return await db.transaction(async (tx) => {
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

    await tx
      .update(schema.inventoryItems)
      .set({ current_stock: String(newStock) })
      .where(eq(schema.inventoryItems.id, itemId));

    return movement;
  });
}

/**
 * Auto-deducts inventory for a completed order based on recipe ingredients.
 * Checks if inventory tracking is enabled for the branch.
 * Marks the order as inventory_deducted to prevent double deduction.
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
    for (const orderItem of orderItemsList) {
      const recipeIngredients = await tx
        .select()
        .from(schema.recipeIngredients)
        .where(eq(schema.recipeIngredients.menu_item_id, orderItem.menu_item_id));

      for (const ingredient of recipeIngredients) {
        const deductQty = parseFloat(ingredient.quantity_used) * orderItem.quantity;

        await tx
          .update(schema.inventoryItems)
          .set({
            current_stock: sql`(${schema.inventoryItems.current_stock}::numeric - ${deductQty})::text`,
          })
          .where(eq(schema.inventoryItems.id, ingredient.inventory_item_id));

        await tx
          .insert(schema.inventoryMovements)
          .values({
            item_id: ingredient.inventory_item_id,
            type: "consumption",
            quantity: String(deductQty),
            reference: orderNumber,
            notes: `Auto-consumo: ${orderItem.name} x${orderItem.quantity}`,
          });
      }
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
