-- Fail-safe logging for editing a customer's phone number: renaming their
-- existing Sales/Service/Enquiry sheet rows in place can fail (a Sheets
-- outage, a permission problem) or be deliberately skipped (another
-- customer record still shares the old number, so a blind rename would
-- wrongly move their rows too) — either way this needs to stay visible,
-- same pattern as every other sheet-sync failure.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'customer_phone_rekey_failed';
