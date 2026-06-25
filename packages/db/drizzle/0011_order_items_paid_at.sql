-- Per-item paid tracking for split-bill payments (tables "cobrar" dialog):
-- staff can settle a shared table item-by-item; null paid_at = still owed.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone;
