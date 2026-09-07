-- Only meaningful when enquiry_source = 'other' — the free-text remark
-- explaining what that "other" way in actually was. Nullable, same
-- pattern as referrer_name/referrer_phone for 'referral' (006).
ALTER TABLE tickets ADD COLUMN source_other_note TEXT;
