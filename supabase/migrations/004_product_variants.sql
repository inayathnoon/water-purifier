-- Business restructured the product sheet: the same product (e.g. "Krystal
-- TRP") now has multiple rows, one per variant (e.g. "RO+UV" vs
-- "RO+UV+AL"), grouped by a shared master_sku. `type` is fully superseded
-- by `variant` — nothing else in the codebase reads it, dropped outright.
--
-- The sheet also no longer carries a price at all; list_price was never
-- actually read anywhere outside the products page (agreed price at sale
-- has always been typed by hand), so it becomes optional rather than
-- required — a future nightly sync stays possible without ever supplying
-- one, and existing prices aren't wiped since the sync omits the column
-- entirely rather than writing null over them.
ALTER TABLE products ADD COLUMN master_sku TEXT;
ALTER TABLE products ADD COLUMN variant TEXT;
ALTER TABLE products ALTER COLUMN list_price DROP NOT NULL;
ALTER TABLE products DROP COLUMN type;
