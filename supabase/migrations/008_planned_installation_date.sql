-- Captured at the moment a purchase is recorded (New Purchase, or an
-- enquiry Convert routed through it) — the customer's expected/target
-- install date, before a specific technician and date are actually
-- booked. Nullable: not always known at sale time.
ALTER TABLE tickets ADD COLUMN planned_installation_date DATE;
