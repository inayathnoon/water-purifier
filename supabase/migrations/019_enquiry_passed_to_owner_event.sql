-- New Telegram notification: fires when an admin passes an enquiry up to
-- the owner (§2.1), same fail-safe logging pattern as every other event.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'enquiry_passed_to_owner';
