import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { couponTypeEnum, couponStatusEnum } from "./enums";
import { organizations } from "./tenants";
import { customers } from "./loyalty";

export const coupons = pgTable("coupons", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  type: couponTypeEnum("type").notNull(),
  status: couponStatusEnum("status").default("active").notNull(),
  discount_value: integer("discount_value"),
  menu_item_id: uuid("menu_item_id"),
  category_id: uuid("category_id"),
  buy_quantity: integer("buy_quantity"),
  get_quantity: integer("get_quantity"),
  min_order_amount: integer("min_order_amount"),
  max_discount_amount: integer("max_discount_amount"),
  max_uses_total: integer("max_uses_total"),
  max_uses_per_customer: integer("max_uses_per_customer").default(1),
  current_uses: integer("current_uses").default(0).notNull(),
  starts_at: timestamp("starts_at"),
  expires_at: timestamp("expires_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const couponAssignments = pgTable(
  "coupon_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coupon_id: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    customer_id: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    sent_at: timestamp("sent_at").defaultNow().notNull(),
    seen_at: timestamp("seen_at"),
    used_at: timestamp("used_at"),
  },
  (t) => [unique("uq_coupon_customer").on(t.coupon_id, t.customer_id)],
);

export const couponRedemptions = pgTable("coupon_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  coupon_id: uuid("coupon_id")
    .notNull()
    .references(() => coupons.id, { onDelete: "cascade" }),
  customer_id: uuid("customer_id"),
  order_id: uuid("order_id"),
  discount_applied: integer("discount_applied").notNull(),
  redeemed_at: timestamp("redeemed_at").defaultNow().notNull(),
});
