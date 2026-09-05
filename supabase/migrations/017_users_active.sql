-- Staff management (add/deactivate) needs a way to retire an account
-- without deleting it (their tickets/orders/leave history stays
-- attached to a real user row) or touching Supabase Auth directly.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
