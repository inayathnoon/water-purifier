-- §13.5's existing guard only checked role — a deactivated technician
-- (see the Developer panel's Deactivate action) could still be assigned a
-- job by anything that bypasses the /api/admin/staff dropdown filter.
-- Same defense-in-depth pattern as every other hard rule here: the DB
-- trigger enforces this independently of the app code.
CREATE OR REPLACE FUNCTION check_assignee_is_service_staff()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assigned_to_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM users WHERE id = NEW.assigned_to_id AND role = 'service_staff' AND active = true
     )
  THEN
    RAISE EXCEPTION 'tickets.assigned_to_id must reference an active service_staff user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
