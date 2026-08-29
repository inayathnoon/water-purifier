-- Switch staff login from email to phone (2026-08-29 architecture change).
-- Field staff don't reliably have personal email addresses; phone number is
-- universal for this team and already the customer lookup key (§4.1).
-- Login goes through Supabase's phone+password grant (not phone+OTP), so
-- this needs no SMS provider and sends no messages, no per-login cost.
--
-- Table is pre-launch and empty (no real accounts created yet), so this is
-- a straight column swap rather than a migrate-then-drop.
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users ADD COLUMN phone TEXT UNIQUE NOT NULL;
