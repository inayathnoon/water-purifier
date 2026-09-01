-- Only meaningful when enquiry_source = 'referral'. Nullable — every other
-- enquiry source leaves these blank.
ALTER TABLE tickets ADD COLUMN referrer_name TEXT;
ALTER TABLE tickets ADD COLUMN referrer_phone TEXT;
