import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { inventoryMovementTypeEnum } from "./enums";
import { organizations, branches } from "./tenants";
import { users } from "./auth";
import { menuItems } from "./menu";

export const inventoryCategories = pgTable("inventory_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
});

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  category_id: uuid("category_id").references(() => inventoryCategories.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  unit: varchar("unit", { length: 50 }).notNull(),
  current_stock: numeric("current_stock", { precision: 10, scale: 3 })
    .default("0")
    .notNull(),
  min_stock: numeric("min_stock", { precision: 10, scale: 3 })
    .default("0")
    .notNull(),
  cost_per_unit: integer("cost_per_unit").default(0).notNull(), // in cents
});

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  item_id: uuid("item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  type: inventoryMovementTypeEnum("type").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  reference: varchar("reference", { length: 255 }),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    menu_item_id: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    inventory_item_id: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    quantity_used: numeric("quantity_used", { precision: 10, scale: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.menu_item_id, table.inventory_item_id] }),
  ],
);
