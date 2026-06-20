-- Deferred foreign keys for order_id / customer_id columns that were declared
-- as plain uuid in the schema TS to avoid circular imports between
-- orders.ts <-> loyalty.ts / coupons.ts. Applied here as raw SQL.
-- All use ON DELETE SET NULL so deleting an order/customer does not cascade-delete
-- historical loyalty / redemption records.

-- loyalty_transactions.order_id -> orders.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_transactions_order_id_orders_id_fk'
  ) THEN
    ALTER TABLE "loyalty_transactions"
      ADD CONSTRAINT "loyalty_transactions_order_id_orders_id_fk"
      FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint

-- reward_redemptions.order_id -> orders.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reward_redemptions_order_id_orders_id_fk'
  ) THEN
    ALTER TABLE "reward_redemptions"
      ADD CONSTRAINT "reward_redemptions_order_id_orders_id_fk"
      FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint

-- coupon_redemptions.order_id -> orders.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupon_redemptions_order_id_orders_id_fk'
  ) THEN
    ALTER TABLE "coupon_redemptions"
      ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk"
      FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint

-- coupon_redemptions.customer_id -> customers.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupon_redemptions_customer_id_customers_id_fk'
  ) THEN
    ALTER TABLE "coupon_redemptions"
      ADD CONSTRAINT "coupon_redemptions_customer_id_customers_id_fk"
      FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;
