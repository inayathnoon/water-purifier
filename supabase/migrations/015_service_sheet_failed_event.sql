-- Mirrors sales_sheet_failed (migration 010) for the new Service sheet
-- sync -- kept as its own enum value rather than reusing sales_sheet_failed
-- so a failure log entry says which sheet actually failed.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'service_sheet_failed';
