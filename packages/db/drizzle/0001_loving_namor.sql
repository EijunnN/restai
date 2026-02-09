ALTER TYPE "public"."order_item_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "branches" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "branches" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "branches" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "branches" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spaces" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "table_assignments" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "table_assignments" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "table_sessions" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "table_sessions" ALTER COLUMN "started_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "table_sessions" ALTER COLUMN "ended_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tables" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tables" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "reward_redemptions" ALTER COLUMN "redeemed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reward_redemptions" ALTER COLUMN "redeemed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shifts" ALTER COLUMN "start_time" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shifts" ALTER COLUMN "end_time" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupon_assignments" ALTER COLUMN "sent_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupon_assignments" ALTER COLUMN "sent_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "coupon_assignments" ALTER COLUMN "seen_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupon_assignments" ALTER COLUMN "used_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ALTER COLUMN "redeemed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ALTER COLUMN "redeemed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "starts_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "idx_sessions_table_status" ON "table_sessions" USING btree ("table_id","status");--> statement-breakpoint
CREATE INDEX "idx_sessions_branch" ON "table_sessions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_menu_items_branch" ON "menu_items" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_menu_items_category" ON "menu_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_orders_branch_status" ON "orders" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_orders_table_session" ON "orders" USING btree ("table_session_id");--> statement-breakpoint
CREATE INDEX "idx_orders_customer" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_orders_created_at" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_loyalty_tx_customer_loyalty" ON "loyalty_transactions" USING btree ("customer_loyalty_id");--> statement-breakpoint
CREATE INDEX "idx_loyalty_tx_order" ON "loyalty_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_branch_series" ON "invoices" USING btree ("branch_id","series");--> statement-breakpoint
CREATE INDEX "idx_payments_order" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_coupon_redemptions_coupon_customer" ON "coupon_redemptions" USING btree ("coupon_id","customer_id");--> statement-breakpoint
ALTER TABLE "table_assignments" ADD CONSTRAINT "uq_table_assignments_table_user" UNIQUE("table_id","user_id");--> statement-breakpoint
ALTER TABLE "customer_loyalty" ADD CONSTRAINT "uq_customer_loyalty_customer_program" UNIQUE("customer_id","program_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "uq_invoices_branch_series_number" UNIQUE("branch_id","series","number");--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "uq_coupons_org_code" UNIQUE("organization_id","code");