CREATE TYPE "public"."coupon_status" AS ENUM('active', 'inactive', 'expired');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('percentage', 'fixed', 'item_free', 'item_discount', 'category_discount', 'buy_x_get_y');--> statement-breakpoint
ALTER TYPE "public"."session_status" ADD VALUE 'pending' BEFORE 'active';--> statement-breakpoint
ALTER TYPE "public"."session_status" ADD VALUE 'rejected';--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"discount_applied" integer NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" "coupon_type" NOT NULL,
	"status" "coupon_status" DEFAULT 'active' NOT NULL,
	"discount_value" integer,
	"menu_item_id" uuid,
	"category_id" uuid,
	"buy_quantity" integer,
	"get_quantity" integer,
	"min_order_amount" integer,
	"max_discount_amount" integer,
	"max_uses_total" integer,
	"max_uses_per_customer" integer DEFAULT 1,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "position_x" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "position_y" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;