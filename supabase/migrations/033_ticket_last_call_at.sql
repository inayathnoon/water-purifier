-- §5.6 revised: a 14+ day old open enquiry's "needs attention" flag now
-- also considers whether it's actually been called recently, not just how
-- old it is. Tracked the same way call_count already is — via the
-- existing trigger on call_log inserts — so it can never drift out of
-- sync with the real call history regardless of which code path logs the
-- call (this same call_log table also backs order payment calls, §7.3;
-- last_call_at is harmless and simply unused for those tickets, which
-- already track their own last_payment_call_at separately).
ALTER TABLE tickets ADD COLUMN last_call_at TIMESTAMP WITH TIME ZONE;

CREATE OR REPLACE FUNCTION bump_ticket_call_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tickets
  SET call_count = call_count + 1, last_call_at = NOW(), updated_at = NOW()
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
