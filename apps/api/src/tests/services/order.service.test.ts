import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  createTestOrg,
  createTestBranch,
  createTestCategory,
  createTestMenuItem,
  createTestTable,
  createTestCustomer,
  createTestLoyaltyProgram,
  createTestTier,
  createTestInventoryItem,
  createTestRecipeIngredient,
  cleanup,
} from "../setup";
import { createOrder, OrderValidationError } from "../../services/order.service";
import { db, schema } from "@restai/db";
import { eq } from "drizzle-orm";

describe("order.service", () => {
  let orgId: string;
  let branchId: string;
  let catId: string;
  let menuItemId: string;
  let menuItemName: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;
    const cat = await createTestCategory(branchId, orgId);
    catId = cat.id;
    const menuItem = await createTestMenuItem(branchId, orgId, catId);
    menuItemId = menuItem.id;
    menuItemName = menuItem.name;
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  it("createOrder with valid items returns order with correct totals", async () => {
    const result = await createOrder({
      organizationId: orgId,
      branchId,
      items: [{ menuItemId, quantity: 2 }],
      type: "dine_in",
    });

    expect(result.order).toBeTruthy();
    expect(result.order.subtotal).toBe(2000); // 10.00 * 2
    expect(result.order.total).toBeGreaterThan(0);
    expect(result.items.length).toBe(1);
    expect(result.items[0].quantity).toBe(2);
  });

  it("createOrder with unavailable item throws OrderValidationError", async () => {
    const unavailable = await createTestMenuItem(branchId, orgId, catId, { is_available: false });

    let caughtError: Error | null = null;
    try {
      await createOrder({
        organizationId: orgId,
        branchId,
        items: [{ menuItemId: unavailable.id, quantity: 1 }],
        type: "dine_in",
      });
    } catch (e: any) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("no disponible");
  });

  it("createOrder with nonexistent item throws OrderValidationError", async () => {
    let caughtError: Error | null = null;
    try {
      await createOrder({
        organizationId: orgId,
        branchId,
        items: [{ menuItemId: crypto.randomUUID(), quantity: 1 }],
        type: "dine_in",
      });
    } catch (e: any) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("no encontrado");
  });

  it("createOrder with soft-deleted item throws OrderValidationError", async () => {
    const deleted = await createTestMenuItem(branchId, orgId, catId);
    await db.update(schema.menuItems).set({ deleted_at: new Date() }).where(eq(schema.menuItems.id, deleted.id));

    let caughtError: Error | null = null;
    try {
      await createOrder({
        organizationId: orgId,
        branchId,
        items: [{ menuItemId: deleted.id, quantity: 1 }],
        type: "dine_in",
      });
    } catch (e: any) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("no encontrado");
  });
});
