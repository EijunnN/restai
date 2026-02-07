CREATE TABLE "coupon_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"seen_at" timestamp,
	"used_at" timestamp,
	CONSTRAINT "uq_coupon_customer" UNIQUE("coupon_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "coupon_assignments" ADD CONSTRAINT "coupon_assignments_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_assignments" ADD CONSTRAINT "coupon_assignments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;