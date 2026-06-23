ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "marketing_opt_in" boolean DEFAULT false NOT NULL
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "consent_at" timestamp with time zone
--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN IF NOT EXISTS "points_expire_after_days" integer
--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone
--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD COLUMN IF NOT EXISTS "expired" boolean DEFAULT false NOT NULL
--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN IF NOT EXISTS "reward_type" text DEFAULT 'discount' NOT NULL
--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN IF NOT EXISTS "menu_item_id" uuid
--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN IF NOT EXISTS "stock_remaining" integer
--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN IF NOT EXISTS "max_per_customer" integer
--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone
--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone
--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD COLUMN IF NOT EXISTS "reward_type" text DEFAULT 'discount' NOT NULL
--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD COLUMN IF NOT EXISTS "discount_type" "discount_type"
--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD COLUMN IF NOT EXISTS "discount_value" integer
--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD COLUMN IF NOT EXISTS "menu_item_id" uuid
--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD COLUMN IF NOT EXISTS "points_spent" integer
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "customer_id" uuid,
  "type" text NOT NULL,
  "channel" text DEFAULT 'email' NOT NULL,
  "to_address" text,
  "subject" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone
)
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_loyalty_tx_expiry" ON "loyalty_transactions" ("type","expired","expires_at")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_log_org" ON "notification_log" ("organization_id")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_log_customer" ON "notification_log" ("customer_id")
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rewards_menu_item_id_menu_items_id_fk') THEN ALTER TABLE "rewards" ADD CONSTRAINT "rewards_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reward_redemptions_menu_item_id_menu_items_id_fk') THEN ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupons_menu_item_id_menu_items_id_fk') THEN ALTER TABLE "coupons" ADD CONSTRAINT "coupons_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupons_category_id_menu_categories_id_fk') THEN ALTER TABLE "coupons" ADD CONSTRAINT "coupons_category_id_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE set null ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_log_organization_id_organizations_id_fk') THEN ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_log_customer_id_customers_id_fk') THEN ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action; END IF; END $$
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_one_active_loyalty_program_per_org" ON "loyalty_programs" ("organization_id") WHERE "is_active"
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customers_org_phone" ON "customers" ("organization_id","phone") WHERE "phone" IS NOT NULL
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customers_org_email" ON "customers" ("organization_id","email") WHERE "email" IS NOT NULL
