-- Fail-safe logging for the new Quotation sheet sync — same pattern as
-- every other sheet-sync failure event. Its own migration/transaction,
-- same reason 031/032 were split: a freshly-added enum value can't
-- safely be used in the same transaction it's created in.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'quotation_sheet_failed';
