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
  // Marketing consent (Ley 29733). marketing_opt_in gates all notifications.
  marketing_opt_in: boolean("marketing_opt_in").default(false).notNull(),
  consent_at: timestamp("consent_at", { withTimezone: true }),
  // Referrals: each customer has a shareable code; referred_by points to the
  // referrer. anonymized_at marks a Ley 29733 data-subject anonymization.
  referral_code: varchar("referral_code", { length: 20 }),
  referred_by: uuid("referred_by"), // FK to customers (self) -- via migration
  anonymized_at: timestamp("anonymized_at", { withTimezone: true }),
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
  // null = points never expire; otherwise earned points expire after N days.
  points_expire_after_days: integer("points_expire_after_days"),
  // Referral rewards: points granted to referrer and referee on the referee's
  // first completed order (0 = referrals disabled).
  referral_referrer_points: integer("referral_referrer_points").default(0).notNull(),
  referral_referee_points: integer("referral_referee_points").default(0).notNull(),
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
  // Set on 'earned' rows when the program has an expiry policy; the expiry job
  // consumes still-unexpired earned points and writes negative 'expired' rows.
  expires_at: timestamp("expires_at", { withTimezone: true }),
  expired: boolean("expired").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_loyalty_tx_customer_loyalty").on(table.customer_loyalty_id),
  index("idx_loyalty_tx_order").on(table.order_id),
  index("idx_loyalty_tx_expiry").on(table.type, table.expired, table.expires_at),
]);

export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  program_id: uuid("program_id")
    .notNull()
    .references(() => loyaltyPrograms.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  points_cost: integer("points_cost").notNull(),
  // "discount" (percentage/fixed off the order) or "free_item" (a specific menu item).
  reward_type: text("reward_type").default("discount").notNull(),
  discount_type: discountTypeEnum("discount_type").notNull(),
  discount_value: integer("discount_value").notNull(),
  menu_item_id: uuid("menu_item_id"), // FK to menu_items (free_item rewards) -- via migration
  stock_remaining: integer("stock_remaining"), // null = unlimited
  max_per_customer: integer("max_per_customer"), // null = unlimited
  starts_at: timestamp("starts_at", { withTimezone: true }),
  expires_at: timestamp("expires_at", { withTimezone: true }),
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
  // Snapshot of the reward's value at redeem time so later admin edits to the
  // reward never retroactively change an already-claimed redemption.
  reward_type: text("reward_type").default("discount").notNull(),
  discount_type: discountTypeEnum("discount_type"),
  discount_value: integer("discount_value"),
  menu_item_id: uuid("menu_item_id"),
  points_spent: integer("points_spent"),
  redeemed_at: timestamp("redeemed_at", { withTimezone: true }).defaultNow().notNull(),
});
