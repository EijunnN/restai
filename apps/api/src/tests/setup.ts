import { db, schema } from "@restai/db";
import { eq, inArray, sql } from "drizzle-orm";

// Unique prefix to avoid collisions with seed data
const TEST_PREFIX = `_test_${Date.now()}_`;
let counter = 0;
function uniq(base: string) { return `${TEST_PREFIX}${base}_${counter++}`; }

export async function createTestOrg() {
  const [org] = await db.insert(schema.organizations).values({
    name: uniq("org"),
    slug: uniq("org"),
  }).returning();
  return org;
}

export async function createTestBranch(orgId: string, settings: Record<string, any> = {}) {
  const [branch] = await db.insert(schema.branches).values({
    organization_id: orgId,
    name: uniq("branch"),
    slug: uniq("branch"),
    settings,
  }).returning();
  return branch;
}

export async function createTestCategory(branchId: string, orgId: string) {
  const [cat] = await db.insert(schema.menuCategories).values({
    branch_id: branchId,
    organization_id: orgId,
    name: uniq("cat"),
  }).returning();
  return cat;
}

export async function createTestMenuItem(branchId: string, orgId: string, categoryId: string, overrides: Partial<typeof schema.menuItems.$inferInsert> = {}) {
  const [item] = await db.insert(schema.menuItems).values({
    category_id: categoryId,
    branch_id: branchId,
    organization_id: orgId,
    name: uniq("item"),
    price: 1000, // 10.00 soles
    ...overrides,
  }).returning();
  return item;
}

export async function createTestTable(branchId: string, orgId: string, number: number = 1) {
  const [table] = await db.insert(schema.tables).values({
    branch_id: branchId,
    organization_id: orgId,
    number,
    qr_code: uniq("qr"),
  }).returning();
  return table;
}

export async function createTestCustomer(orgId: string, overrides: Partial<typeof schema.customers.$inferInsert> = {}) {
  const [customer] = await db.insert(schema.customers).values({
    organization_id: orgId,
    name: uniq("customer"),
    ...overrides,
  }).returning();
  return customer;
}

export async function createTestLoyaltyProgram(orgId: string) {
  const [program] = await db.insert(schema.loyaltyPrograms).values({
    organization_id: orgId,
    name: uniq("program"),
    points_per_currency_unit: 1,
    is_active: true,
  }).returning();
  return program;
}

export async function createTestTier(programId: string, minPoints: number = 0, multiplier: number = 100) {
  const [tier] = await db.insert(schema.loyaltyTiers).values({
    program_id: programId,
    name: uniq("tier"),
    min_points: minPoints,
    multiplier,
  }).returning();
  return tier;
}

export async function createTestReward(programId: string, pointsCost: number = 100) {
  const [reward] = await db.insert(schema.rewards).values({
    program_id: programId,
    name: uniq("reward"),
    points_cost: pointsCost,
    discount_type: "percentage",
    discount_value: 10,
    is_active: true,
  }).returning();
  return reward;
}

export async function createTestInventoryItem(branchId: string, orgId: string, stock: number = 100) {
  const [item] = await db.insert(schema.inventoryItems).values({
    branch_id: branchId,
    organization_id: orgId,
    name: uniq("inv_item"),
    unit: "kg",
    current_stock: String(stock),
    min_stock: "0",
  }).returning();
  return item;
}

export async function createTestRecipeIngredient(menuItemId: string, inventoryItemId: string, quantityUsed: number = 1) {
  await db.insert(schema.recipeIngredients).values({
    menu_item_id: menuItemId,
    inventory_item_id: inventoryItemId,
    quantity_used: String(quantityUsed),
  });
}

// Cleanup: delete test orgs (cascades to everything else).
// We must delete orders first because order_items has a RESTRICT FK to menu_items,
// which blocks cascade deletion from organizations -> branches -> menu_items.
export async function cleanup(orgIds: string[]) {
  if (orgIds.length === 0) return;
  // Delete orders first (cascades to order_items, removing RESTRICT blockers)
  await db.delete(schema.orders).where(inArray(schema.orders.organization_id, orgIds));
  // Now safe to cascade-delete everything else
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, orgIds));
}
