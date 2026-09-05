-- New Telegram notification: fires when an owner approves or denies a
-- leave request (§11.3/§11.4) — previously the only silent step in the
-- whole leave flow, same fail-safe logging pattern as every other event.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'leave_decided';
