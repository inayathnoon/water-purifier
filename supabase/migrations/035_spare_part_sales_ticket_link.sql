-- A spare part sold at the office (no ticket) stays exactly as before.
-- A spare part sold as part of confirming a job (installation or service
-- visit) now carries that ticket's id, so the sale is traceable back to
-- the specific job it came from — previously spare_part_sales had no
-- linkage at all. Nullable: office sales keep ticket_id null.
ALTER TABLE spare_part_sales ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES tickets(id);
