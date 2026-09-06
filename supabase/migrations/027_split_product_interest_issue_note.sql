-- Root cause of the "technician never saw the reported problem" bug
-- (2026-09-06): enquiry_product_interest was reused three ways — a plain
-- product name (enquiry/installation), a product name copied from the
-- parent installation (Yearly Service), and "{product} — {issue}" only
-- on an ad-hoc Service Call — so a naive reader couldn't tell a routine
-- check-up from an actual complaint without also knowing the ticket's
-- kind and lineage. Splitting into two honest columns makes that
-- ambiguity structurally impossible instead of worked around per-reader.
--
-- enquiry_product_interest itself is left in place, still written
-- exactly as before — the Sales/Service/Enquiry sheets, the Purchases
-- page, and the Customer Directory all still read it for display, and
-- none of them have the ambiguity problem (they show it as one free-text
-- line either way). issue_note is the new, narrow fix for the one place
-- that actually needed a clean signal: a technician's job card.
ALTER TABLE tickets ADD COLUMN product_interest TEXT;
ALTER TABLE tickets ADD COLUMN issue_note TEXT;

-- Backfill: an ad-hoc Service Call (service_visit, no parent_installation_id)
-- is the only kind that ever joined a product and an issue together —
-- split on the exact " — " separator createAdHocServiceRequest() uses.
-- A value with no separator there is a pure issue note (the form allows
-- leaving product as "(not sure yet)", which joins to just the issue).
UPDATE tickets
SET
  product_interest = CASE WHEN enquiry_product_interest LIKE '% — %' THEN split_part(enquiry_product_interest, ' — ', 1) ELSE NULL END,
  issue_note = CASE
    WHEN enquiry_product_interest LIKE '% — %'
      THEN substring(enquiry_product_interest FROM position(' — ' IN enquiry_product_interest) + length(' — '))
    ELSE enquiry_product_interest
  END
WHERE kind = 'service_visit' AND parent_installation_id IS NULL AND enquiry_product_interest IS NOT NULL;

-- Every other kind (enquiry, installation, Yearly Service) only ever
-- held a plain product name in this column — no issue to split out.
UPDATE tickets
SET product_interest = enquiry_product_interest
WHERE enquiry_product_interest IS NOT NULL
  AND NOT (kind = 'service_visit' AND parent_installation_id IS NULL);
