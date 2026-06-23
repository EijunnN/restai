ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "referral_code" varchar(20)
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "referred_by" uuid
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "anonymized_at" timestamp with time zone
--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN IF NOT EXISTS "referral_referrer_points" integer DEFAULT 0 NOT NULL
--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN IF NOT EXISTS "referral_referee_points" integer DEFAULT 0 NOT NULL
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "batch_id" uuid
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "referrer_customer_id" uuid NOT NULL,
  "referee_customer_id" uuid NOT NULL,
  "code" varchar(20) NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "referrer_points" integer DEFAULT 0 NOT NULL,
  "referee_points" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "days_of_week" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "start_time" varchar(5),
  "end_time" varchar(5),
  "multiplier" integer DEFAULT 100 NOT NULL,
  "bonus_points" integer DEFAULT 0 NOT NULL,
  "tier_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
)
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coupons_batch" ON "coupons" ("batch_id")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referrals_org" ON "referrals" ("organization_id")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referrals_referrer" ON "referrals" ("referrer_customer_id")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referrals_referee" ON "referrals" ("referee_customer_id")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaigns_org_status" ON "campaigns" ("organization_id","status")
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customers_org_referral_code" ON "customers" ("organization_id","referral_code") WHERE "referral_code" IS NOT NULL
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_referred_by_customers_id_fk') THEN ALTER TABLE "customers" ADD CONSTRAINT "customers_referred_by_customers_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_organization_id_organizations_id_fk') THEN ALTER TABLE "referrals" ADD CONSTRAINT "referrals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_referrer_customer_id_customers_id_fk') THEN ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_customer_id_customers_id_fk" FOREIGN KEY ("referrer_customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_referee_customer_id_customers_id_fk') THEN ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_customer_id_customers_id_fk" FOREIGN KEY ("referee_customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_organization_id_organizations_id_fk') THEN ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_tier_id_loyalty_tiers_id_fk') THEN ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tier_id_loyalty_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."loyalty_tiers"("id") ON DELETE set null ON UPDATE no action; END IF; END $$
