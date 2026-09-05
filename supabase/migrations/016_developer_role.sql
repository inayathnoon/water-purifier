-- A distinct role for the app's own developer/maintainer — separate from
-- 'owner' (the business owner) so the two can see genuinely different
-- pages: 'owner' gets the business dashboard, 'developer' gets a
-- maintenance panel (staff management, sheet links, etc.).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'developer';
