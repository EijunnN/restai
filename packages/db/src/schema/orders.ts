import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import {
  orderTypeEnum,
  orderStatusEnum,
  orderItemStatusEnum,
} from "./enums";
import { organizations, branches } from "./tenants";
import { tableSessions } from "./tables";
import { customers } from "./loyalty";
import { menuItems } from "./menu";
import { modifiers } from "./menu";

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  table_session_id: uuid("table_session_id").references(
    () => tableSessions.id,
    { onDelete: "set null" },
  ),
  customer_id: uuid("customer_id").references(() => customers.id, {
    onDelete: "set null",
  }),
  order_number: varchar("order_number", { length: 20 }).notNull(),
  type: orderTypeEnum("type").default("dine_in").notNull(),
  status: orderStatusEnum("status").default("pending").notNull(),
  customer_name: varchar("customer_name", { length: 255 }),
  subtotal: integer("subtotal").notNull().default(0),
  tax: integer("tax").notNull().default(0),
  discount: integer("discount").notNull().default(0),
  total: integer("total").notNull().default(0),
  notes: text("notes"),
  inventory_deducted: boolean("inventory_deducted").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_orders_branch_status").on(table.branch_id, table.status),
  index("idx_orders_table_session").on(table.table_session_id),
  index("idx_orders_customer").on(table.customer_id),
  index("idx_orders_created_at").on(table.created_at),
]);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  order_id: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  menu_item_id: uuid("menu_item_id")
    .notNull()
    .references(() => menuItems.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 255 }).notNull(), // snapshot
  unit_price: integer("unit_price").notNull(), // snapshot in cents
  quantity: integer("quantity").notNull().default(1),
  total: integer("total").notNull(), // in cents
  notes: text("notes"),
  status: orderItemStatusEnum("status").default("pending").notNull(),
}, (table) => [
  index("idx_order_items_order").on(table.order_id),
]);

export const orderItemModifiers = pgTable("order_item_modifiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  order_item_id: uuid("order_item_id")
    .notNull()
    .references(() => orderItems.id, { onDelete: "cascade" }),
  modifier_id: uuid("modifier_id")
    .notNull()
    .references(() => modifiers.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 255 }).notNull(), // snapshot
  price: integer("price").notNull().default(0), // snapshot in cents
});
