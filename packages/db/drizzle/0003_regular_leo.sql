ALTER TABLE "orders" ADD COLUMN "delivery_address" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_driver_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_driver_id_users_id_fk" FOREIGN KEY ("delivery_driver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;