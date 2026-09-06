-- "Prices, payments and charges can all be edited with no trace of who
-- did it" — payment_history already proves the pattern (one JSONB
-- column, appended to, no separate audit table needed) for orders;
-- this is the same idea for the one place a ticket's own charge/parts/
-- notes get overwritten after the fact: a tech's §8.4 mistake-fix window
-- correcting their own completed service visit.
ALTER TABLE tickets ADD COLUMN edit_history JSONB NOT NULL DEFAULT '[]'::jsonb;
