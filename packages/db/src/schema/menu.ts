import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  primaryKey,
  index,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { organizations, branches } from "./tenants";

export const menuCategories = pgTable("menu_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  image_url: text("image_url"),
  sort_order: integer("sort_order").default(0).notNull(),
  is_active: boolean("is_active").default(true).notNull(),
});

export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  category_id: uuid("category_id")
    .notNull()
    .references(() => menuCategories.id, { onDelete: "cascade" }),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: integer("price").notNull(), // stored in cents
  image_url: text("image_url"),
  is_available: boolean("is_available").default(true).notNull(),
  sort_order: integer("sort_order").default(0).notNull(),
  preparation_time_min: integer("preparation_time_min"),
  /**
   * Alérgenos declarados, p. ej. ["gluten","lacteos","mani"]. No es cosmético:
   * un comensal celíaco necesita saberlo antes de pedir, y el local necesita
   * poder demostrar que lo informó.
   */
  allergens: jsonb("allergens").$type<string[]>().default([]).notNull(),
  /** Etiquetas dietéticas: ["vegetariano","vegano","sin_gluten"]. */
  dietary_tags: jsonb("dietary_tags").$type<string[]>().default([]).notNull(),
  /** Nivel de picante 0–3 (null = no aplica). */
  spice_level: integer("spice_level"),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("idx_menu_items_branch").on(table.branch_id),
  index("idx_menu_items_category").on(table.category_id),
]);

export const modifierGroups = pgTable("modifier_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  min_selections: integer("min_selections").default(0).notNull(),
  max_selections: integer("max_selections").default(1).notNull(),
  is_required: boolean("is_required").default(false).notNull(),
});

export const modifiers = pgTable("modifiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  group_id: uuid("group_id")
    .notNull()
    .references(() => modifierGroups.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  price: integer("price").default(0).notNull(), // stored in cents
  is_available: boolean("is_available").default(true).notNull(),
});

export const menuItemModifierGroups = pgTable(
  "menu_item_modifier_groups",
  {
    item_id: uuid("item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    group_id: uuid("group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.item_id, table.group_id] }),
  ],
);
