-- §6 requires an Email delivery route (mailto:, disabled when no address
-- is on file) — the brief's own §3 schema omitted a column for this, and
-- nothing elsewhere in this app captures a customer email at all
-- (customers has none). Added narrowly here, on quotations only, rather
-- than opening up customer email as a new concept app-wide.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS email TEXT;
