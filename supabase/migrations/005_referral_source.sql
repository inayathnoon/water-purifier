-- A referral is a distinct enquiry_source, with who referred them worth
-- capturing so a repeat referrer's name autofills next time from their
-- phone number, the same way a repeat customer's details do.
ALTER TYPE enquiry_source ADD VALUE 'referral';
