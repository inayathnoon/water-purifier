-- Sales/orders need to show real product structure (brand, name, variant,
-- SKU, master SKU) instead of a single free-text "product interest"
-- string. That structure only exists on the `products` table, so a
-- purchase now records which product row it was (by SKU/code) at the
-- moment it's created via ProductPicker — nullable, since historical
-- imports and free-text "Other" purchases have no matching product row.
ALTER TABLE tickets ADD COLUMN product_code TEXT REFERENCES products(code);
