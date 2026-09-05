-- One-time bootstrap for the Developer panel's migration runner — after
-- this, every future migration applies with a click instead of a trip to
-- the SQL Editor. exec_sql() only ever runs the fixed contents of a
-- committed migration file from the app's own server code (never
-- free-typed SQL from a browser) — see lib/services/migrations.ts.
CREATE OR REPLACE FUNCTION exec_sql(sql text) RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only ever touched by supabaseAdmin (service role, bypasses RLS) from
-- the migration runner itself — RLS with zero policies means anon/
-- authenticated clients get nothing at all, which is exactly right here.
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- Backfill every migration already applied by hand so the runner never
-- tries to replay them (this file included, to stop it re-running itself).
INSERT INTO schema_migrations (filename) VALUES
  ('001_init_schema.sql'),
  ('002_users_phone_login.sql'),
  ('003_enquiry_source.sql'),
  ('004_product_variants.sql'),
  ('005_referral_source.sql'),
  ('006_referrer_fields.sql'),
  ('007_customer_multiple_addresses.sql'),
  ('008_planned_installation_date.sql'),
  ('009_ticket_product_code.sql'),
  ('010_sales_sheet_failed_event.sql'),
  ('011_payments_log.sql'),
  ('012_payment_history_column.sql'),
  ('013_address_not_uppercased.sql'),
  ('014_order_confirmation_status.sql'),
  ('015_service_sheet_failed_event.sql'),
  ('016_developer_role.sql'),
  ('017_users_active.sql'),
  ('018_assignee_must_be_active.sql'),
  ('019_enquiry_passed_to_owner_event.sql'),
  ('020_migration_runner_bootstrap.sql')
ON CONFLICT (filename) DO NOTHING;
