-- §7.2: orders.paid_amount only ever held a running total — there was no
-- record of *when* each payment came in, just the current cumulative
-- number. The admin dashboard's payments-outstanding list needs to show
-- "payments received against date" per customer, which needs an actual
-- log, not a single mutable total.
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payments_order_id_idx ON payments(order_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Same access shape as orders itself: owners/admins only (service staff
-- never see prices/balances, §13.4).
CREATE POLICY payments_read ON payments FOR SELECT
  USING ((SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin'));

CREATE POLICY payments_write ON payments FOR INSERT
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) IN ('owner', 'admin'));
