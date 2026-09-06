-- Fail-safe logging for the new office spare-part sale sheet sync
-- (found in a full operational review, 2026-09-06, as the only revenue
-- path in this app with no ledger row) — same pattern as every other
-- sheet-sync failure event.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'spare_part_sale_sheet_failed';
