ALTER TABLE "table_sessions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "deleted_at" timestamp with time zone;