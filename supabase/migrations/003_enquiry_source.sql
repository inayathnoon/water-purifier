-- Enquiries carry more nuance than a flat "open" ticket: some walk in
-- already sure what they want, some just came to get their water tested
-- before deciding anything. The business has always tracked this
-- informally; this makes it a real field so it shows in the enquiry list
-- instead of living only in call notes.
CREATE TYPE enquiry_source AS ENUM ('general', 'water_test', 'ready_to_buy');

-- Nullable and only meaningful on kind='enquiry' rows — installations and
-- service visits never set this.
ALTER TABLE tickets ADD COLUMN enquiry_source enquiry_source;
