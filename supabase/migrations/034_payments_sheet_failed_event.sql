-- Fail-safe logging for the new Payments sheet sync (a pure money
-- ledger — one row per payment event across every revenue channel) —
-- same pattern as every other sheet-sync failure event.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'payments_sheet_failed';
