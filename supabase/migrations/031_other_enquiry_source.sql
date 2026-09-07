-- "Other" as a distinct enquiry_source, for a way an enquiry came in that
-- doesn't fit general/water_test/ready_to_buy/referral. Split into its own
-- file, same as 005_referral_source.sql, since a new enum value can't
-- safely be used in the same transaction it's added in.
ALTER TYPE enquiry_source ADD VALUE 'other';
