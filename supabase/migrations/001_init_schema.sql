-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'service_staff');
CREATE TYPE ticket_kind AS ENUM ('enquiry', 'installation', 'service_visit');
CREATE TYPE ticket_status AS ENUM ('open', 'booked', 'completed', 'closed', 'passed_to_owner', 'inactive');
CREATE TYPE half_day AS ENUM ('morning', 'afternoon', 'evening');
CREATE TYPE location_type AS ENUM ('home', 'office');
CREATE TYPE notification_status AS ENUM ('sent', 'failed', 'pending');
CREATE TYPE event_type AS ENUM ('job_assigned', 'job_completed', 'leave_requested', 'payment_reminder', 'product_sync_failed');
CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'denied');

-- Users table (extends Supabase auth.users)
CREATE TABLE users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role user_role NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Customers table
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  area TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Function to normalize text to uppercase
CREATE OR REPLACE FUNCTION normalize_customer_text()
RETURNS TRIGGER AS $$
BEGIN
  NEW.name := UPPER(NEW.name);
  NEW.address := UPPER(NEW.address);
  NEW.area := UPPER(NEW.area);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to normalize customer data
CREATE TRIGGER normalize_customer_before_insert_update
BEFORE INSERT OR UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION normalize_customer_text();

-- Tickets table (covers enquiry, installation, service_visit)
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  kind ticket_kind NOT NULL,
  status ticket_status NOT NULL,
  assigned_to_id UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Enquiry-specific fields
  enquiry_product_interest TEXT,
  call_count INTEGER DEFAULT 0,
  callback_date DATE,
  closure_reason TEXT,
  closure_explanation TEXT,

  -- Installation/Service-specific fields
  booked_date DATE,
  booked_half_day half_day,
  location location_type,
  actual_date DATE,
  actual_start_time TIME,
  actual_end_time TIME,
  actual_notes TEXT,

  -- Service visit-specific fields
  parts_used TEXT,
  charge_amount NUMERIC(10, 2),

  -- Warranty/Service tracking
  installation_date DATE,
  warranty_expires_at DATE,
  service_declined BOOLEAN DEFAULT FALSE,

  -- Recorded at the moment an enquiry converts (§5.7) — carried onto the
  -- installation ticket that's created, so the order created later at
  -- closing (§7.1) uses the price agreed when the customer said yes, not
  -- whatever the product happens to cost today.
  agreed_price NUMERIC(10, 2),

  -- Cancellation (§6.8: cancelling a job requires a reason)
  cancellation_reason TEXT,

  -- Set on service_visit tickets, pointing back at the installation that
  -- triggered them (§8.2). Doubles as the "has this installation's yearly
  -- check already been created" guard for the nightly cron — one query,
  -- no separate flag to keep in sync.
  parent_installation_id UUID REFERENCES tickets(id)
);

-- Constraint: only service_staff can be assigned jobs
ALTER TABLE tickets
ADD CONSTRAINT only_service_staff_assigned
CHECK (
  assigned_to_id IS NULL
  OR EXISTS (SELECT 1 FROM users WHERE id = assigned_to_id AND role = 'service_staff')
);

-- Order status: 'open' while anything is owed (§7.3 — chased every 3 days),
-- 'closed' once paid in full. This is a separate lifecycle from the
-- installation ticket's own 'closed' status (§7.1: closing the ticket is
-- what *creates* the order — the order itself may still sit open for weeks
-- after that while payment is chased).
CREATE TYPE order_status AS ENUM ('open', 'closed');

-- Orders table (1:1 with an installation ticket, created when that ticket closes)
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL UNIQUE REFERENCES tickets(id),
  status order_status NOT NULL DEFAULT 'open',
  list_price NUMERIC(10, 2) NOT NULL,
  sold_price NUMERIC(10, 2) NOT NULL,
  paid_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,

  -- Computed, never hand-set (§7.2) — no screen can produce an
  -- inconsistent discount or balance because these aren't writable columns.
  discount NUMERIC(10, 2) GENERATED ALWAYS AS (list_price - sold_price) STORED,
  balance_owed NUMERIC(10, 2) GENERATED ALWAYS AS (sold_price - paid_amount) STORED,

  last_payment_call_at TIMESTAMP WITH TIME ZONE,
  owner_notified_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT list_price_non_negative CHECK (list_price >= 0),
  CONSTRAINT sold_price_non_negative CHECK (sold_price >= 0),
  CONSTRAINT paid_amount_non_negative CHECK (paid_amount >= 0),
  CONSTRAINT paid_not_more_than_sold CHECK (paid_amount <= sold_price)
);

-- Hard rule §7.5 / §13.1: an order cannot be closed while money is owed.
-- Enforced here so it holds no matter which screen or future code path
-- tries to set status = 'closed'.
CREATE OR REPLACE FUNCTION check_order_payment_before_close()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND (NEW.sold_price - NEW.paid_amount) > 0 THEN
    RAISE EXCEPTION 'Cannot close order with outstanding balance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_order_payment_on_close
BEFORE INSERT OR UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION check_order_payment_before_close();

-- Call log (§5.2: every call attempt logged with what came of it — nobody
-- should have to remember what was said last time). One row per attempt;
-- tickets.call_count is a denormalized counter kept in sync by the trigger
-- below so "has this enquiry ever been called" (§5.5) is a cheap check.
CREATE TABLE call_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  note TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION bump_ticket_call_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tickets
  SET call_count = call_count + 1, updated_at = NOW()
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bump_call_count_after_call_log_insert
AFTER INSERT ON call_log
FOR EACH ROW
EXECUTE FUNCTION bump_ticket_call_count();

-- Products table (synced from Google Sheets)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  list_price NUMERIC(10, 2) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Time off (§11). A technician requests dates + a reason; it waits, and
-- only an owner decides (§11.3 — explicitly not the admin, unlike most
-- other admin actions an owner can also cover). Refusing requires a
-- reason (§11.4), same spirit as the 30-word rule on enquiries.
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES users(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status leave_status NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES users(id),
  decision_reason TEXT,
  decided_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT end_after_start CHECK (end_date >= start_date)
);

CREATE OR REPLACE FUNCTION check_leave_denial_reason()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'denied' AND (NEW.decision_reason IS NULL OR trim(NEW.decision_reason) = '') THEN
    RAISE EXCEPTION 'Refusing leave requires a reason';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_leave_denial_reason
BEFORE UPDATE ON leave_requests
FOR EACH ROW
EXECUTE FUNCTION check_leave_denial_reason();

-- Notifications log (for tracking Telegram/webhook failures)
CREATE TABLE notifications_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type event_type NOT NULL,
  status notification_status NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_customers_phone ON customers(phone_number);
CREATE INDEX idx_tickets_customer ON tickets(customer_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_assigned_to ON tickets(assigned_to_id);
CREATE INDEX idx_tickets_kind ON tickets(kind);
CREATE INDEX idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX idx_tickets_parent_installation ON tickets(parent_installation_id);
CREATE INDEX idx_tickets_warranty_expires ON tickets(warranty_expires_at) WHERE kind = 'installation';
CREATE INDEX idx_orders_ticket ON orders(ticket_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_products_code ON products(code);
CREATE INDEX idx_products_active ON products(active);
CREATE INDEX idx_notifications_created ON notifications_log(created_at DESC);
CREATE INDEX idx_call_log_ticket ON call_log(ticket_id);
CREATE INDEX idx_leave_requester ON leave_requests(requester_id);
CREATE INDEX idx_leave_status ON leave_requests(status);
CREATE INDEX idx_leave_dates ON leave_requests(start_date, end_date);

-- Row-Level Security (RLS) Policies
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_log_read ON call_log FOR SELECT
  USING ((SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin'));

CREATE POLICY call_log_write ON call_log FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- Owner/admin see every request; a technician sees only their own (§11.1).
CREATE POLICY leave_read ON leave_requests FOR SELECT
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin')
    OR requester_id = auth.uid()
  );

CREATE POLICY leave_write ON leave_requests FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- §11.3: only an owner decides — not the admin, unlike most other actions
-- an owner can also cover for the admin on.
CREATE POLICY leave_update ON leave_requests FOR UPDATE
  USING ((SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'service_role'));

-- Customers: everyone can read, admin/owner can modify
CREATE POLICY customers_read ON customers FOR SELECT
  USING (true);

CREATE POLICY customers_write ON customers FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY customers_update ON customers FOR UPDATE
  USING (auth.role() IN ('authenticated', 'service_role'));

-- Tickets: everyone can read own assigned/related, admin/owner can modify
CREATE POLICY tickets_read ON tickets FOR SELECT
  USING (
    -- Owners/Admin see everything
    (SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin')
    -- Service staff see only their assigned tickets
    OR assigned_to_id = auth.uid()
  );

CREATE POLICY tickets_write ON tickets FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY tickets_update ON tickets FOR UPDATE
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin')
    OR assigned_to_id = auth.uid()
  );

-- Orders: admin/owner can read/modify, service staff cannot see
CREATE POLICY orders_read ON orders FOR SELECT
  USING ((SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin', 'service_role'));

CREATE POLICY orders_write ON orders FOR INSERT
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin', 'service_role'));

CREATE POLICY orders_update ON orders FOR UPDATE
  USING ((SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin', 'service_role'));

-- Products: everyone can read
CREATE POLICY products_read ON products FOR SELECT
  USING (true);

CREATE POLICY products_write ON products FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY products_update ON products FOR UPDATE
  USING (auth.role() IN ('authenticated', 'service_role'));

-- Notifications log: internal only
CREATE POLICY notifications_read ON notifications_log FOR SELECT
  USING ((SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin', 'service_role'));

CREATE POLICY notifications_write ON notifications_log FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
