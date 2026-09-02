-- New, separate tracking dimension from Installation status: after a job
-- is installed, the business wants a follow-up satisfaction call made
-- within the following month, distinct from the original "confirm the
-- job was done" call that stamps installation_date. Defaults to
-- 'pending' for every order, including the 96 just reimported —
-- deliberately not backfilled as already-confirmed, since no such call
-- was ever specifically logged for them.
CREATE TYPE confirmation_status AS ENUM ('pending', 'completed');

ALTER TABLE orders ADD COLUMN confirmation_status confirmation_status NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN confirmation_note TEXT;
ALTER TABLE orders ADD COLUMN confirmed_at TIMESTAMPTZ;
