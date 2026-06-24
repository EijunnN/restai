DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_reference_invoice_id_invoices_id_fk') THEN ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reference_invoice_id_invoices_id_fk" FOREIGN KEY ("reference_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action; END IF; END $$
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sunat_config_ruc') THEN ALTER TABLE "sunat_config" ADD CONSTRAINT "chk_sunat_config_ruc" CHECK (ruc ~ '^(10|15|16|17|20)[0-9]{9}$'); END IF; END $$
