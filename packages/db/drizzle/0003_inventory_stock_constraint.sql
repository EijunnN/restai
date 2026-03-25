ALTER TABLE "inventory_items" ADD CONSTRAINT "chk_non_negative_stock" CHECK (current_stock::numeric >= 0);
