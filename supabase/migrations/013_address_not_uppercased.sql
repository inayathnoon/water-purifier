-- Business decision (2026-09-02): name and area stay normalized to
-- UPPERCASE (unambiguous for matching/display), but address should be
-- left exactly as typed — mixed case is easier to actually read back for
-- a street address. CREATE OR REPLACE keeps the same trigger attached,
-- just drops the address line from what it touches.
CREATE OR REPLACE FUNCTION normalize_customer_text()
RETURNS TRIGGER AS $$
BEGIN
  NEW.name := UPPER(NEW.name);
  NEW.area := UPPER(NEW.area);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
