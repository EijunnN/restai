import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  date,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import {
  loyaltyTransactionTypeEnum,
  discountTypeEnum,
} from "./enums";
import { organizations } from "./tenants";

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  birth_date: date("birth_date"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const loyaltyPrograms = pgTable("loyalty_programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  points_per_currency_unit: integer("points_per_currency_unit").default(1).notNull(),
  currency_per_point: integer("currency_per_point").default(100).notNull(), // in cents
  is_active: boolean("is_active").default(true).notNull(),
});

export const loyaltyTiers = pgTable("loyalty_tiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  program_id: uuid("program_id")
    .notNull()
    .references(() => loyaltyPrograms.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  min_points: integer("min_points").default(0).notNull(),
  multiplier: integer("multiplier").default(100).notNull(), // 100 = 1.00x
  benefits: jsonb("benefits").default({}).notNull(),
});

export const customerLoyalty = pgTable("customer_loyalty", {
  id: uuid("id").primaryKey().defaultRandom(),
  customer_id: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  program_id: uuid("program_id")
    .notNull()
    .references(() => loyaltyPrograms.id, { onDelete: "cascade" }),
  points_balance: integer("points_balance").default(0).notNull(),
  total_points_earned: integer("total_points_earned").default(0).notNull(),
  tier_id: uuid("tier_id").references(() => loyaltyTiers.id, {
    onDelete: "set null",
  }),
}, (table) => [
  unique("uq_customer_loyalty_customer_program").on(table.customer_id, table.program_id),
]);

// Forward-declared reference: orders is in orders.ts which imports from this file.
// loyalty_transactions.order_id will reference orders table.
// We use a raw SQL reference or defer it. Since orders imports customers from here,
// we avoid circular dependency by making order_id a plain uuid without a TS-level reference.
export const loyaltyTransactions = pgTable("loyalty_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  customer_loyalty_id: uuid("customer_loyalty_id")
    .notNull()
    .references(() => customerLoyalty.id, { onDelete: "cascade" }),
  order_id: uuid("order_id"), // FK to orders -- applied via migration to avoid circular import
  points: integer("points").notNull(),
  type: loyaltyTransactionTypeEnum("type").notNull(),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_loyalty_tx_customer_loyalty").on(table.customer_loyalty_id),
  index("idx_loyalty_tx_order").on(table.order_id),
]);

export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  program_id: uuid("program_id")
    .notNull()
    .references(() => loyaltyPrograms.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  points_cost: integer("points_cost").notNull(),
  discount_type: discountTypeEnum("discount_type").notNull(),
  discount_value: integer("discount_value").notNull(),
  is_active: boolean("is_active").default(true).notNull(),
});

export const rewardRedemptions = pgTable("reward_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  customer_loyalty_id: uuid("customer_loyalty_id")
    .notNull()
    .references(() => customerLoyalty.id, { onDelete: "cascade" }),
  reward_id: uuid("reward_id")
    .notNull()
    .references(() => rewards.id, { onDelete: "restrict" }),
  order_id: uuid("order_id"), // FK to orders -- applied via migration to avoid circular import
  redeemed_at: timestamp("redeemed_at", { withTimezone: true }).defaultNow().notNull(),
});
