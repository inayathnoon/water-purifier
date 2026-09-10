-- A service visit can't be marked done until the admin has gone through
-- the spare-parts step for it at least once (either recording real parts
-- via Sell Spare Part, or explicitly saying none were needed) — see
-- CLAUDE.md's staff-portal-removal follow-up note. Nullable-false with a
-- default of false so every existing ticket (already past this point,
-- since the gate didn't exist yet) is unaffected.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS spares_confirmed BOOLEAN NOT NULL DEFAULT false;
