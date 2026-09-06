-- Correction to migration 027's backfill: a handful of ad-hoc Service
-- Call rows (pre-dating createAdHocServiceRequest()'s issue-note
-- requirement — imported historical data) had *only* a bare product name
-- recorded, no separator, no issue text at all — e.g. "Kitchen" with
-- nothing else. 027's heuristic ("no separator in the joined field means
-- it's a pure issue note") wrongly classified that bare product name as
-- issue_note, which would show a technician "Reported problem: Kitchen"
-- on a real, currently-booked job — not an actual complaint.
--
-- Reclassify: if the no-separator value exactly matches one of this
-- app's three known product categories (case-insensitive — the New
-- Service form's own dropdown options), it's a product, not an issue.
UPDATE tickets
SET product_interest = issue_note, issue_note = NULL
WHERE kind = 'service_visit'
  AND parent_installation_id IS NULL
  AND product_interest IS NULL
  AND lower(trim(issue_note)) IN ('kitchen', 'vessel', 'commercial');
