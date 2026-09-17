-- Quotations — replaces the hand-written carbon book. A separate numbering
-- series from the paper book on purpose: the book keeps its own numbers
-- (currently in the 300s) and the app never touches them. Printed with a
-- "Q-" prefix (quotation_defaults.quote_prefix) precisely so a bare
-- "No. 1" is never ambiguous next to a paper "No. 303" from the same period.
CREATE SEQUENCE IF NOT EXISTS quotation_quote_no_seq START 1;

CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Allocated server-side by the sequence default, never computed
  -- client-side (max()+1 races on a double-submit) — the sequence itself
  -- guarantees no two quotations ever get the same number, even on a
  -- rolled-back insert (a gap there is fine; a duplicate is not).
  quote_no INT UNIQUE NOT NULL DEFAULT nextval('quotation_quote_no_seq'),
  -- The only credential /q/[token] accepts — never the row id, so a
  -- customer-facing link can't be turned into an enumeration of every
  -- quotation just by incrementing a number.
  public_token TEXT UNIQUE NOT NULL,
  quote_date DATE NOT NULL,
  -- Nullable: a walk-in quote that never became a real customer record.
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  phone_number TEXT,
  address TEXT,
  area TEXT,
  notes TEXT,
  -- Each quotation freezes its own terms text at save time (see
  -- quotation_defaults below) — editing the remembered defaults later
  -- must never reach back and change what an already-issued quotation
  -- printed.
  terms TEXT,
  delivery_date TEXT,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  particulars TEXT NOT NULL,
  -- The indented sub-lines under a particulars entry (e.g. the book's
  -- bundled "1) Multi media filter... 2) Iron remover..." breakdown) —
  -- free text, line breaks preserved verbatim as typed.
  details TEXT,
  qty NUMERIC NOT NULL DEFAULT 1,
  rate NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  -- Set only when ProductPicker resolved to a real products.code — same
  -- convention as tickets.product_code (lib/db.ts). Rate is never
  -- prefilled from this even when set; a quotation's price is always
  -- typed by hand, negotiated per deal.
  product_code TEXT
);

-- One remembered row of header/terms defaults, prefilled into every new
-- quotation and edited independently of any single saved quotation (see
-- quotations.terms/notes above for why those freeze their own copy).
-- The values below are transcribed from the reference quote (No. 303)
-- where given in the brief; the street address was not supplied and is
-- left blank here deliberately rather than invented — fill it in via
-- the app's own "Header & terms" section before the first real quotation
-- goes out.
CREATE TABLE IF NOT EXISTS quotation_defaults (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name TEXT NOT NULL DEFAULT 'NOON ENTERPRISES',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '0490 2323930',
  mobile TEXT NOT NULL DEFAULT '9995589930',
  email TEXT NOT NULL DEFAULT 'noonwaterpurifierstly@gmail.com',
  notes TEXT NOT NULL DEFAULT 'Free installation and one year warranty',
  terms TEXT NOT NULL DEFAULT E'100% payment at the time of delivery\nSubject to Thalassery jurisdiction\nE&OE',
  delivery_date_label TEXT NOT NULL DEFAULT 'Delivery date: ……',
  signatory_line TEXT NOT NULL DEFAULT 'Sales Executive',
  quote_prefix TEXT NOT NULL DEFAULT 'Q',
  -- Last print mode used, remembered so the common case is one click —
  -- see /admin/quotations/[id]'s Blank paper / Letterhead pad toggle.
  print_mode TEXT NOT NULL DEFAULT 'blank' CHECK (print_mode IN ('blank', 'letterhead')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO quotation_defaults (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Only ever touched by supabaseAdmin (service role) from the admin API
-- routes, plus the public /q/[token] read path — same "RLS with zero
-- policies, service role bypasses it" pattern as spare_part_sales.
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_defaults ENABLE ROW LEVEL SECURITY;
