-- Run in Supabase SQL editor.
--
-- price_history_item_code_fkey (price_history.item_code → pricing_master) was
-- created with the default NO ACTION on update and delete. That made two
-- intended behaviours impossible:
--
--   Delete — items keep their price history so re-adding the same code later
--            reconnects to it. The key refused any delete of an item that had
--            history, failing single and bulk deletes alike.
--   Rename — rename_item_codes moves history explicitly alongside the code, but
--            the key rejected the pricing_master update first, so any item with
--            history could not be renamed.
--
-- The link the key enforces is exactly the one those features need to be able
-- to break, so the key goes. price_history keeps item_code as a plain column
-- and continues to join to pricing_master by value.

ALTER TABLE price_history DROP CONSTRAINT IF EXISTS price_history_item_code_fkey;

-- Verify — should return no rows:
--   SELECT conname FROM pg_constraint WHERE confrelid = 'pricing_master'::regclass;
