-- Structured line items behind a service visit's charge_amount — so a
-- "Sales by Category" report can split the total into spare-parts revenue
-- vs. the flat service-charge line, instead of only having an opaque
-- total plus a free-text summary (parts_used) that isn't safe to parse.
-- Same "one JSONB column, no new table" pattern as orders.payment_history.
ALTER TABLE tickets ADD COLUMN charge_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;
