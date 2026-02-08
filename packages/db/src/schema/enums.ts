import { pgEnum } from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", [
  "free",
  "starter",
  "pro",
  "enterprise",
]);

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "org_admin",
  "branch_manager",
  "cashier",
  "waiter",
  "kitchen",
]);

export const tableStatusEnum = pgEnum("table_status", [
  "available",
  "occupied",
  "reserved",
  "maintenance",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "pending",
  "active",
  "completed",
  "rejected",
]);

export const orderTypeEnum = pgEnum("order_type", [
  "dine_in",
  "takeout",
  "delivery",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "served",
  "completed",
  "cancelled",
]);

export const orderItemStatusEnum = pgEnum("order_item_status", [
  "pending",
  "preparing",
  "ready",
  "served",
  "cancelled",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "card",
  "yape",
  "plin",
  "transfer",
  "other",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "completed",
  "refunded",
]);

export const invoiceTypeEnum = pgEnum("invoice_type", [
  "boleta",
  "factura",
]);

export const docTypeEnum = pgEnum("doc_type", [
  "dni",
  "ruc",
  "ce",
]);

export const sunatStatusEnum = pgEnum("sunat_status", [
  "pending",
  "sent",
  "accepted",
  "rejected",
]);

export const inventoryMovementTypeEnum = pgEnum("inventory_movement_type", [
  "purchase",
  "consumption",
  "waste",
  "adjustment",
]);

export const loyaltyTransactionTypeEnum = pgEnum("loyalty_transaction_type", [
  "earned",
  "redeemed",
  "adjusted",
  "expired",
]);

export const discountTypeEnum = pgEnum("discount_type", [
  "percentage",
  "fixed",
]);

export const couponTypeEnum = pgEnum("coupon_type", [
  "percentage",
  "fixed",
  "item_free",
  "item_discount",
  "category_discount",
  "buy_x_get_y",
]);

export const couponStatusEnum = pgEnum("coupon_status", [
  "active",
  "inactive",
  "expired",
]);
