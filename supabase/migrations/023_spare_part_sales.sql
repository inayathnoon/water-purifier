-- Spare parts can be sold on their own at the office (no technician
-- visit involved) -- a separate lightweight record from a service_visit
-- ticket, since there's no job, no assigned tech, and often no known
-- customer relationship (a walk-in buying a valve doesn't need §4.1's
-- phone lookup treatment the way a real sale does).
CREATE TABLE IF NOT EXISTS spare_part_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_name TEXT NOT NULL,
  unit_price NUMERIC NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  total NUMERIC NOT NULL,
  customer_name TEXT,
  phone_number TEXT,
  sold_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only ever touched by supabaseAdmin (service role) from the admin API
-- routes -- same "RLS with zero policies" pattern as schema_migrations.
ALTER TABLE spare_part_sales ENABLE ROW LEVEL SECURITY;
