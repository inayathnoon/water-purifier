-- New event type for the sales-sheet write-back (mirrors product_sync_failed) —
-- a failure logging into notifications_log must never throw and block a
-- real order from closing, same reasoning as every other Telegram/webhook
-- failure in this table. Enum values must be added in their own
-- transaction, separate from anything that uses them (see 003/005).
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'sales_sheet_failed';
