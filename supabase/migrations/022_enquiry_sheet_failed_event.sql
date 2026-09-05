-- New Telegram-style fail-safe logging event for the Enquiry sheet sync
-- (lib/services/enquirySheet.ts), same pattern as sales_sheet_failed and
-- service_sheet_failed.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'enquiry_sheet_failed';
