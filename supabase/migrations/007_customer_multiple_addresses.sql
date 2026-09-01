-- §4.1 revised: a phone number can now have more than one address on file
-- (e.g. a customer who moved, or two households sharing a number) —
-- previously one phone number could only ever be one customer record.
-- Phone number stays the primary way staff look someone up; it's no
-- longer required to be unique on its own. The app now surfaces every
-- matching address for a number and lets the admin pick one, or add a
-- new address under the same number.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_number_key;
