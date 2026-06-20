CREATE TYPE "public"."sunat_ambiente" AS ENUM('beta', 'production');--> statement-breakpoint
ALTER TYPE "public"."invoice_type" ADD VALUE 'nota_credito';--> statement-breakpoint
ALTER TYPE "public"."invoice_type" ADD VALUE 'nota_debito';--> statement-breakpoint
ALTER TYPE "public"."sunat_status" ADD VALUE 'observed' BEFORE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."sunat_status" ADD VALUE 'voided';--> statement-breakpoint
ALTER TYPE "public"."sunat_status" ADD VALUE 'error';--> statement-breakpoint
CREATE TABLE "sunat_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ruc" varchar(11) NOT NULL,
	"razon_social" varchar(255) NOT NULL,
	"nombre_comercial" varchar(255),
	"ubigeo" varchar(6),
	"departamento" varchar(100),
	"provincia" varchar(100),
	"distrito" varchar(100),
	"direccion" text,
	"ambiente" "sunat_ambiente" DEFAULT 'beta' NOT NULL,
	"endpoint_override" text,
	"sol_user_enc" text,
	"sol_pass_enc" text,
	"cert_enc" text,
	"cert_pass_enc" text,
	"cert_format" varchar(10) DEFAULT 'pfx',
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sunat_config_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sunat_ticket" varchar(50);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sunat_hash" varchar(100);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sunat_code" varchar(10);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sunat_description" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "xml_signed" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cdr_xml" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reference_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "note_motive_code" varchar(5);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "note_motive_description" text;--> statement-breakpoint
ALTER TABLE "sunat_config" ADD CONSTRAINT "sunat_config_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoices_sunat_status" ON "invoices" USING btree ("branch_id","sunat_status");