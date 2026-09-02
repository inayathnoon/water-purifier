-- Replacing the `payments` table from 011 (applied seconds ago, zero real
-- rows) with a simpler design: a JSON column on `orders` itself instead
-- of a whole new table + RLS policy + join. Same end result — a dated
-- list of payments per order for the admin dashboard's "payments
-- received against date" — with less to maintain: no second place
-- "how much was paid" can drift from orders.paid_amount, no new join
-- needed anywhere this already selects orders(*).
DROP TABLE IF EXISTS payments;

ALTER TABLE orders ADD COLUMN payment_history JSONB NOT NULL DEFAULT '[]'::jsonb;
