-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'service_staff');
CREATE TYPE ticket_kind AS ENUM ('enquiry', 'installation', 'service_visit');
CREATE TYPE ticket_status AS ENUM ('open', 'booked', 'completed', 'closed', 'passed_to_owner', 'inactive');
CREATE TYPE half_day AS ENUM ('morning', 'afternoon', 'evening');
CREATE TYPE location_type AS ENUM ('home', 'office');
CREATE TYPE notification_status AS ENUM ('sent', 'failed', 'pending');
CREATE TYPE event_type AS ENUM ('job_assigned', 'job_completed', 'leave_requested', 'payment_reminder');

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
  service_declined BOOLEAN DEFAULT FALSE
);

-- Constraint: only service_staff can be assigned jobs
ALTER TABLE tickets
ADD CONSTRAINT only_service_staff_assigned
CHECK (
  assigned_to_id IS NULL
  OR EXISTS (SELECT 1 FROM users WHERE id = assigned_to_id AND role = 'service_staff')
);

-- Orders table (1:1 with installation tickets when closed)
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL UNIQUE REFERENCES tickets(id),
  list_price NUMERIC(10, 2) NOT NULL,
  sold_price NUMERIC(10, 2) NOT NULL,
  paid_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Computed columns (views for discount and balance_owed to avoid duplication)
ALTER TABLE orders
ADD CONSTRAINT list_price_non_negative CHECK (list_price >= 0),
ADD CONSTRAINT sold_price_non_negative CHECK (sold_price >= 0),
ADD CONSTRAINT paid_amount_non_negative CHECK (paid_amount >= 0),
ADD CONSTRAINT paid_not_more_than_sold CHECK (paid_amount <= sold_price);

-- Function to prevent closing order while balance owed
CREATE OR REPLACE FUNCTION check_order_payment_before_close()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' THEN
    IF (NEW.sold_price - NEW.paid_amount) > 0 THEN
      RAISE EXCEPTION 'Cannot close order with outstanding balance';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce payment rule
CREATE TRIGGER enforce_order_payment_on_close
BEFORE UPDATE ON tickets
FOR EACH ROW
WHEN (OLD.kind = 'installation' AND NEW.status = 'closed')
EXECUTE FUNCTION check_order_payment_before_close();

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
CREATE INDEX idx_orders_ticket ON orders(ticket_id);
CREATE INDEX idx_products_code ON products(code);
CREATE INDEX idx_products_active ON products(active);
CREATE INDEX idx_notifications_created ON notifications_log(created_at DESC);

-- Row-Level Security (RLS) Policies
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_log ENABLE ROW LEVEL SECURITY;

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
