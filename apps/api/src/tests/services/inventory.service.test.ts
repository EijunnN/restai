import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestOrg, createTestBranch, createTestCategory, createTestMenuItem, createTestTable, createTestInventoryItem, createTestRecipeIngredient, cleanup } from "../setup";
import { recordMovement, deductForOrder, InsufficientStockError } from "../../services/inventory.service";
import { db, schema } from "@restai/db";
import { eq } from "drizzle-orm";

describe("inventory.service", () => {
  let orgId: string;
  let branchId: string;
  let invItemId: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;
    const invItem = await createTestInventoryItem(branchId, orgId, 50);
    invItemId = invItem.id;
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  it("recordMovement purchase increases stock", async () => {
    const movement = await recordMovement({
      itemId: invItemId,
      type: "purchase",
      quantity: 10,
    });

    expect(movement.type).toBe("purchase");

    const [item] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, invItemId)).limit(1);
    expect(parseFloat(item.current_stock)).toBe(60);
  });

  it("recordMovement consumption decreases stock", async () => {
    const movement = await recordMovement({
      itemId: invItemId,
      type: "consumption",
      quantity: 5,
    });

    expect(movement.type).toBe("consumption");

    const [item] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, invItemId)).limit(1);
    expect(parseFloat(item.current_stock)).toBe(55);
  });

  it("deductForOrder deducts based on recipes", async () => {
    // Create menu item with recipe
    const cat = await createTestCategory(branchId, orgId);
    const menuItem = await createTestMenuItem(branchId, orgId, cat.id);
    const invItem2 = await createTestInventoryItem(branchId, orgId, 20);
    await createTestRecipeIngredient(menuItem.id, invItem2.id, 2); // 2 units per item

    // Create an order
    const [order] = await db.insert(schema.orders).values({
      organization_id: orgId,
      branch_id: branchId,
      order_number: "TEST-001",
      type: "dine_in",
      status: "completed",
      subtotal: 2000,
      tax: 360,
      discount: 0,
      total: 2360,
    }).returning();

    await db.insert(schema.orderItems).values({
      order_id: order.id,
      menu_item_id: menuItem.id,
      name: menuItem.name,
      unit_price: menuItem.price,
      quantity: 3,
      total: menuItem.price * 3,
    });

    // Enable inventory for branch
    await db.update(schema.branches).set({ settings: { inventory_enabled: true } }).where(eq(schema.branches.id, branchId));

    await deductForOrder({ orderId: order.id, orderNumber: "TEST-001", branchId });

    const [updated] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, invItem2.id)).limit(1);
    // 20 - (2 * 3) = 14
    expect(parseFloat(updated.current_stock)).toBe(14);

    // Verify order flagged
    const [updatedOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id)).limit(1);
    expect(updatedOrder.inventory_deducted).toBe(true);
  });

  it("deductForOrder throws InsufficientStockError when stock is insufficient", async () => {
    // Use a separate branch to avoid shared state issues
    const branch2 = await createTestBranch(orgId, { inventory_enabled: true });
    const cat = await createTestCategory(branch2.id, orgId);
    const menuItem = await createTestMenuItem(branch2.id, orgId, cat.id);
    const invItem3 = await createTestInventoryItem(branch2.id, orgId, 1); // only 1 in stock
    await createTestRecipeIngredient(menuItem.id, invItem3.id, 5); // needs 5 per item

    const [order] = await db.insert(schema.orders).values({
      organization_id: orgId,
      branch_id: branch2.id,
      order_number: "TEST-002",
      type: "dine_in",
      status: "completed",
      subtotal: 2000,
      tax: 360,
      discount: 0,
      total: 2360,
    }).returning();

    await db.insert(schema.orderItems).values({
      order_id: order.id,
      menu_item_id: menuItem.id,
      name: menuItem.name,
      unit_price: menuItem.price,
      quantity: 2, // needs 5*2=10 but only 1 in stock
      total: menuItem.price * 2,
    });

    let caughtError: Error | null = null;
    try {
      await deductForOrder({ orderId: order.id, orderNumber: "TEST-002", branchId: branch2.id });
    } catch (e: any) {
      caughtError = e;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.name).toBe("InsufficientStockError");
    expect(caughtError!.message).toContain("Stock insuficiente");
  });

  it("deductForOrder skips when inventory not enabled", async () => {
    // Create a separate branch without inventory enabled
    const branch2 = await createTestBranch(orgId, { inventory_enabled: false });
    const cat = await createTestCategory(branch2.id, orgId);
    const menuItem = await createTestMenuItem(branch2.id, orgId, cat.id);

    const [order] = await db.insert(schema.orders).values({
      organization_id: orgId,
      branch_id: branch2.id,
      order_number: "TEST-003",
      type: "dine_in",
      status: "completed",
      subtotal: 1000,
      tax: 180,
      discount: 0,
      total: 1180,
    }).returning();

    await db.insert(schema.orderItems).values({
      order_id: order.id,
      menu_item_id: menuItem.id,
      name: menuItem.name,
      unit_price: menuItem.price,
      quantity: 1,
      total: menuItem.price,
    });

    // Should not throw
    await deductForOrder({ orderId: order.id, orderNumber: "TEST-003", branchId: branch2.id });

    // Order should NOT be flagged since inventory was skipped
    const [updatedOrder] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id)).limit(1);
    expect(updatedOrder.inventory_deducted).toBe(false);
  });
});
