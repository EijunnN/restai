-- Enforce non-negative inventory stock at the database level.
-- (The previously orphaned 0003_inventory_stock_constraint.sql was never
--  registered in meta/_journal.json, so it never ran. This re-adds it as a
--  properly numbered, journal-registered migration.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_non_negative_stock'
  ) THEN
    ALTER TABLE "inventory_items"
      ADD CONSTRAINT "chk_non_negative_stock" CHECK (current_stock::numeric >= 0);
  END IF;
END
$$;
