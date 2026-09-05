-- Real gap found 2026-09-05: migration 001 enabled RLS on customers,
-- tickets, orders, products, notifications_log, call_log, and
-- leave_requests -- but never on `users` itself. With RLS off, Postgres
-- has no row-level restriction at all, so the table was fully readable
-- by anyone holding the public anon key (shipped in the browser bundle,
-- not a secret) -- no login required. Confirmed live: an unauthenticated
-- request returned every staff member's name, phone number, and role.
--
-- Every legitimate read of this table from a non-admin (RLS-respecting)
-- client only ever needs the caller's own row (getCurrentUser() in
-- lib/auth.ts, requireUser() in lib/api-auth.ts) -- every cross-user
-- lookup (staff dropdowns, the Developer panel, job assignment checks)
-- already goes through supabaseAdmin, which bypasses RLS entirely. So a
-- single "read your own row" policy, no write policies at all (writes
-- only ever happen via the service role), covers every real path.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_read_own ON users FOR SELECT
  USING (id = auth.uid());
