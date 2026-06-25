-- Email-code (OTP) login for returning customers. Stores only a hash of the
-- 6-digit code; short-lived, single-use, attempt-capped (see customer.ts login).
CREATE TABLE IF NOT EXISTS "customer_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_login_codes" ADD CONSTRAINT "customer_login_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_login_codes" ADD CONSTRAINT "customer_login_codes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_login_codes_customer" ON "customer_login_codes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_login_codes_expiry" ON "customer_login_codes" USING btree ("expires_at");
