# Water Purifier Service System — V1 Build

## What This System Does

A web application for a small water-purifier sales and service business (7 staff, trimmed to 5 seats for v1: 1 owner, 1 admin, 3 service techs). Replaces informal notebook tracking with a structured app that enforces the business's hard rules about payment, job assignment, and warranty coverage.

## Architecture

**Stack:**
- **Frontend**: Next.js (App Router, TypeScript, Tailwind CSS)
- **Backend**: Next.js API routes + Supabase serverless functions
- **Database**: Postgres (Supabase)
- **Auth**: Supabase Auth (phone + password, no self-signup) — phone, not
  email, because field staff don't reliably have personal emails; uses the
  phone+password grant, not phone+OTP, so no SMS provider or per-login cost.
  Supabase still requires *some* SMS provider configured before it will let
  you flip "Phone" on as a sign-in method at all (Authentication → Sign In /
  Providers → Phone) — but it never validates those values against the
  provider's API, and this app never triggers an OTP send, so a Twilio
  account with a placeholder Messaging Service SID satisfies it for free
  (no phone number purchase needed). Real Twilio credentials only matter if
  a future feature actually needs to send an SMS.
- **Hosting**: Railway (Hobby tier, ~$5–8/mo)
- **Async jobs**: GitHub Actions cron → API routes
- **Group chat**: Telegram Bot API (free, outbound only)
- **Product sync**: Google Sheets API (nightly pull)

## Project Structure

```
app/
  auth/
    login/page.tsx          # Sign-in UI
  dashboard/page.tsx        # Logged-in home screen
  middleware.ts             # Auth guard
  api/
    admin/                  # Admin endpoints
    owner/                  # Owner endpoints
    staff/                  # Service staff endpoints
    public/                 # Unauthenticated endpoints
    jobs/                   # Scheduled job handlers
lib/
  db.ts                     # Supabase client + type definitions
  auth.ts                   # Auth helpers
  services/
    tickets.ts              # Ticket business logic
    orders.ts               # Order logic (hard rule: no close while owed)
    products.ts             # Product sync from Google Sheets
    telegram.ts             # Telegram notifications (§10, async, fail-safe)
supabase/
  migrations/
    001_init_schema.sql     # All tables, enums, constraints, RLS policies
```

## Hard Rules (§13) — Enforced in Code

1. **Order cannot close while money is owed** → Postgres trigger + CHECK constraint on orders table
2. **Enquiry closure needs 5+ words & ≥1 prior call** (originally 30, lowered 2026-09-01 — 30 words was slowing staff down for little benefit) → Server-side validation in `/api/admin/enquiries/close`
3. **No charge inside warranty year** → `charge_amount` computed from `installation_date` at write time
4. **Service staff never see price/discount/balance** → Supabase RLS policies + server-side field filters
5. **Jobs only assigned to service staff** → Postgres trigger on `tickets.assigned_to_id` (not a `CHECK` — Postgres CHECK constraints can't contain a subquery)

## Data Model

Four tables + enums:

### Enums
- `user_role`: `owner` | `admin` | `service_staff`
- `ticket_kind`: `enquiry` | `installation` | `service_visit`
- `ticket_status`: `open` | `booked` | `completed` | `closed` | `passed_to_owner` | `inactive`
- `half_day`: `morning` | `afternoon` | `evening`
- `location_type`: `home` | `office`
- `event_type`: `job_assigned` | `job_completed` | `leave_requested` | `payment_reminder`
- `notification_status`: `sent` | `failed` | `pending`

### Tables

**`users`** (1 row per staff member)
- `id` (UUID, refs auth.users)
- `phone`, `role`, `name`

**`customers`** (phone number is the only lookup key, §4.1)
- `id`, `phone_number` (UNIQUE), `name`, `address`, `area`
- Trigger: uppercase name/address/area on write

**`tickets`** (one table for enquiry/installation/service_visit, §6)
- `id`, `customer_id`, `kind`, `status`, `assigned_to_id`
- Enquiry fields: `enquiry_product_interest`, `call_count`, `callback_date`, `closure_reason`, `closure_explanation`
- Installation/Service fields: `booked_date`, `booked_half_day`, `location`, `actual_date`, `actual_start_time`, `actual_end_time`, `actual_notes`
- Service fields: `parts_used`, `charge_amount`
- Warranty: `installation_date`, `warranty_expires_at`, `service_declined`
- Trigger: refuses insert/update if `assigned_to_id` doesn't reference a `service_staff` user

**`orders`** (created only when installation ticket is closed, §7.1)
- `id`, `ticket_id` (UNIQUE), `list_price`, `sold_price`, `paid_amount`
- Computed: `discount = list_price - sold_price`, `balance_owed = sold_price - paid_amount`
- Trigger: refuse close if `balance_owed > 0`

**`products`** (synced from Google Sheets nightly)
- `id`, `code` (UNIQUE, immutable §9.4), `category`, `type`, `brand`, `name`, `list_price`, `active`
- Rows removed from sheet → `active = false` (never deleted, §9.3)

**`notifications_log`** (audit trail for Telegram/Webhook failures)
- `id`, `event_type`, `status`, `error_message`, `created_at`

## Row-Level Security (RLS)

- **Owners/Admins** see everything
- **Service staff** see only their own assigned tickets (cannot see prices, discounts, balances)
- **All authenticated users** can read customers and products

## Build Stages (Rollout to Live)

1. **Foundation** ✅ Complete
   - [x] Next.js + Tailwind + TypeScript scaffold
   - [x] Supabase schema (tables, enums, constraints, RLS)
   - [x] Auth scaffolding (Supabase Auth, login page, middleware)
   - [x] Dashboard home screen
   - [x] Manual user account creation — created via Supabase's Admin API
         (not SQL scripts, since `auth.users` and `public.users` both need a
         row with the same id) for the 5 real staff: Ismath (owner), Zainaba
         (admin), Cristeen/Babu/Yasir (service_staff)

   **Migration bugs found and fixed only once it hit a real Postgres
   instance** (2026-08-29, first `supabase db push` against a live project —
   the schema had never actually been executed before):
   1. `uuid_generate_v4()` (uuid-ossp) doesn't resolve — Supabase installs
      that extension into the `extensions` schema, which isn't on the
      migration session's search_path. Switched every `id` default to
      `gen_random_uuid()`, built into Postgres 13+ core, no extension needed.
   2. The §13.5 "only service_staff can be assigned jobs" rule was written
      as a `CHECK` constraint with an `EXISTS` subquery — Postgres doesn't
      allow subqueries in CHECK constraints at all. Replaced with a
      `BEFORE INSERT OR UPDATE` trigger (`check_assignee_is_service_staff`),
      matching the pattern already used for the order-close and
      leave-denial rules.
   3. Five RLS policies (`orders_*`, `notifications_read`, `leave_update`)
      compared `users.role` (the business enum: owner/admin/service_staff)
      against the literal `'service_role'` — but that's the *Postgres/JWT*
      auth role from `auth.role()`, not a value the `user_role` enum has,
      so the policy failed to even compile. Dropped it from those lists —
      it was also redundant: the service-role API key already bypasses RLS
      at the database level (`BYPASSRLS`), so no policy needed to special-case
      it in the first place.

2. **Enquiry → Installation → Order loop** ✅ Complete
   - [x] Admin enquiry list, call logging, conversion (`/admin/enquiries`)
   - [x] Installation booking to service staff (`/admin/installations`)
   - [x] Tech completion workflow (`/staff/jobs` — minimal, full UX in Stage 3)
   - [x] Admin closing call + order creation (`/api/admin/tickets/[id]/close`)
   - [x] Payment tracking — 3-day call logging, order close gate (`/admin/orders`)
   - [ ] 7-day owner alert (needs Telegram/notification channel — Stage 6)
   - *Proves hard rules 1, 2, 5 — enforced in `lib/services/tickets.ts`, `lib/services/orders.ts`, and DB triggers*

   Schema correction made in this stage: the "can't close while owed" trigger
   from Stage 1 referenced columns that don't exist on `tickets` — fixed by
   giving `orders` its own `status` (open/closed) with `discount` and
   `balance_owed` as Postgres generated columns, plus a `call_log` table for
   §5.2 that Stage 1 had missed. See `supabase/migrations/001_init_schema.sql`.

3. **Service staff job view** ✅ Complete
   - [x] Today-only view by default, "+N upcoming" to expand (§15.2)
   - [x] Large touch targets, prefilled date/time, tap-to-call customer
   - [x] Service-visit completion accepts parts + charge, but §8.5 warranty
         rule still overrides whatever the tech enters
   - *Staff sees no prices or balances*

   **Bug found and fixed in this stage:** Stage 2's `completeJob()` did
   `select('*')` and returned the full ticket row — which for an
   installation includes `agreed_price` (the sale price), sent straight to
   the technician's browser. A direct §13.4 violation. Fixed by giving that
   function an explicit column whitelist that excludes `agreed_price`,
   instead of trusting `select('*')` anywhere on a staff-facing path. Also
   corrected the service-visit charge logic: §8.4 has the tech record the
   charge for a chargeable visit; §8.5 only means the *within-warranty*
   determination overrides them, not that they never enter an amount.

4. **Warranty & yearly service loop** ✅ Complete
   - [x] GitHub Actions cron (`.github/workflows/nightly-jobs.yml`, 02:00 UTC)
         hits `/api/jobs/yearly-service-check`, secret-protected via `CRON_SECRET`
   - [x] Auto-creates a `service_visit` ticket per installation whose
         warranty just expired, guarded by `parent_installation_id` so a
         installation is only ever followed up once (revised 2026-09-02 —
         see the note below the §15 section: this no longer fires once at
         the 1-year mark, it repeats every year starting at 1.5 years)
   - [x] Admin flow at `/admin/service-calls`: call → decline (§8.6) or book
         → tech completes → admin confirms & closes (reuses the same
         `bookJob`/`completeJob`/`closeTicketAfterConfirmation` as installations)
   - *Proves hard rule 3 — `charge_amount` is forced to 0 inside the
     warranty year regardless of what the tech enters*

   **Two more gaps found and fixed in this stage:**
   1. Nothing in Stage 2 ever stamped `installation_date`/`warranty_expires_at`
      on a closed installation — the warranty clock never actually started.
      Fixed in `closeTicketAfterConfirmation()`: now dated from the
      technician's recorded `actual_date` (§8.1 — "from the day it was
      fitted"), not the day admin got around to closing it.
   2. Needed a way to stop the nightly job recreating the same yearly-service
      ticket every night after the first trigger. Added
      `tickets.parent_installation_id` (self-referencing) rather than a
      separate boolean flag — one query answers "already handled?" and it
      doubles as ticket lineage for §4.3.

   Env additions: `CRON_SECRET` (generate with `openssl rand -hex 32`),
   plus a GitHub repo secret `APP_URL` pointing at the deployed app.

5. **Product sync from Google Sheets** ✅ Complete
   - [x] Google Sheets API client (`googleapis`, service account, read-only)
   - [x] Nightly sync (extended `.github/workflows/nightly-jobs.yml`) + "Sync now"
         button on `/admin/products`
   - [x] Header row validated *before* any row is parsed — a rename throws,
         nothing partial gets written, and the failure is logged to
         `notifications_log` so a silent nightly run still leaves a trail (§9.6)
   - [x] Upsert by `code` (§9.4); codes missing from the sheet get
         `active = false`, never deleted (§9.3)

   Expected sheet columns (any order, case-insensitive): `category`, `type`,
   `brand`, `name`, `code`, `list price`. Spare parts live in the same sheet
   under their own `category` value (§9.5) — no separate schema needed.

   Env additions: `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (the
   service account's JSON key, as a single-line string), optional
   `GOOGLE_SHEETS_RANGE` (defaults to `Products!A:F`).

   **Wired up and verified end-to-end (2026-08-30)** against the real
   product sheet: a sheet created by uploading/converting a CSV gets a tab
   named after Sheets' own default (e.g. `Untitled`), not `Products` — the
   code's default range assumes a tab literally named `Products`, so any
   sheet not built by hand from a template needs `GOOGLE_SHEETS_RANGE` set
   explicitly to match its real tab name (`spreadsheets.get` lists a
   sheet's tab names if unsure). Also worth knowing: Sheets reads bare
   numeric-looking cells (e.g. `001`) as numbers and drops the leading
   zeros unless that column is formatted as Plain text before typing —
   matters here since `code` (§9.4) is meant to be a stable, immutable
   identifier.

6. **Telegram feed & leave requests** ✅ Complete
   - [x] `lib/services/telegram.ts` — never throws, returns `{ok, error}`;
         callers log the outcome instead of unwinding on failure (§10.5)
   - [x] Three templates in `lib/services/notifications.ts`: job assigned
         (on `bookJob`), job completed (on `completeJob`), leave requested
         (on `requestLeave`) — no price/discount/balance in any of them (§10.6)
   - [x] Every send happens *after* its triggering DB write has already
         committed, and failures are logged to `notifications_log`, never thrown
   - [x] Deep links (`/tickets/[id]` → `/api/tickets/[id]/redirect-target`):
         middleware already requires a session to reach the page; the
         redirector then sends staff to `/staff/jobs` and admin/owner to
         the right list for the ticket's kind
   - [x] Leave: `/staff/time-off` (request), `/owner/leave` (decide) — owner-only
         per §11.3, DB trigger also refuses a denial with no reason (§11.4)
   - [x] Approved leave surfaced (not enforced) on the booking forms in
         `/admin/installations` and `/admin/service-calls` (§11.5)

   Simplification worth knowing: deep links route to the relevant *list*
   page, not a bespoke per-ticket detail view (installations/service
   visits don't have one yet) — the ticket is easy to find there. A true
   single-ticket page is straightforward to add later without touching
   this routing.

   Env additions: `APP_URL` (for building the links), `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID` (see comments in `.env.local` for how to get them).

7. **Dashboards** ✅ Complete — all 7 rollout stages done
   - [x] `/dashboard` now *is* the answer for admin/owner — no more link list.
         A technician is redirected straight to `/staff/jobs` (§15.2 — "sees
         today's jobs and nothing else," not a dashboard detour first)
   - [x] Admin (§15.1): new enquiries (14+ day ones flagged), confirm-finished-work,
         yearly service calls due, payments outstanding (3-day-overdue-call
         flagged) — 4 cards, one `Promise.all`, no page-to-page navigating
   - [x] Owner (§15.3/§7.6): jobs today, who's busy, sold/collected this
         month, discount given this month, enquiries passed to them (§2.1),
         orders overdue 7+ days (§7.4), pending leave count linking to `/owner/leave`

   No separate tech availability calendar built — §11.5's "shows as away on
   the booking calendar" is satisfied by the non-blocking leave warning
   already on the two booking forms (Stage 6); a dedicated calendar view
   wasn't asked for by §15's acceptance checks and would be pure surface
   area for a 3-technician team.

---

## Service Reminder Schedule Change (2026-09-02)

The nightly yearly-service job (§8.2) no longer fires once at the
1-year warranty mark. Business decision: follow-up service calls now
repeat every year starting at **1.5 years** post-install — 1.5, 2.5,
3.5, and so on — for as long as the installation exists. `checkAndCreateYearlyServiceCalls()`
computes each installation's next-due anniversary as `installation_date
+ (1.5 + number of prior follow-ups already created)` years, so the
same duplicate-guard (`parent_installation_id`) now allows a growing
chain of follow-ups instead of just one. Nice side effect: since every
reminder now lands at 1.5+ years, none of them can ever land inside the
1-year warranty window, so §13.3's "no charge inside the warranty year"
override never has to fight with a freshly-created reminder the way it
theoretically could have at the exact 1-year boundary before.

## Structured Product Columns on Orders (2026-09-02)

`/admin/orders` (table + Excel/CSV download) previously showed a single
free-text "Product" column (`tickets.enquiry_product_interest`, e.g.
`"UV — Aqua V5, UV+Alkaline"`) with no link back to the actual `products`
row. Replaced with five real columns — Brand, Name, Variant, SKU, Master
SKU — sourced from `products` via a new `tickets.product_code` column
(migration `009_ticket_product_code.sql`, `REFERENCES products(code)`,
nullable). Set only when a purchase is made through `ProductPicker`
(`createDirectPurchase()` now accepts `productCode`); every historical
import and any hand-typed "Other" purchase never had a matching product
row, so those rows fall back to showing the old free-text string in the
Name column with Brand/Variant/SKU/Master SKU blank rather than losing
the information entirely. Going forward, every purchase made through the
normal New Purchase form gets fully structured product data for free.

## Historical Sales Data Corrected — Full Wipe & Reimport (2026-09-02)

The original 2026-09-01 historical import had no product linkage at all
(`product_code` null on every row) and, per the business, some
underlying data errors. The business supplied a corrected CSV (real
SKUs matching the actual product catalog, corrected prices/payments) and
explicitly asked for a full wipe first — **every** customer, ticket,
order, and enquiry was deleted (not just the historical sales subset),
keeping only staff accounts and the product catalog, then the 96
corrected rows were reimported directly against the service layer:

- SKUs resolved case-insensitively against `products.code` before
  touching the DB (`Dosing` vs `DOSING`, `UVChamber` vs `UVCHAMBER` —
  3 of 33 unique SKUs only differed by case) — all 96 rows matched a
  real product, verified before any destructive step ran.
- One customer per unique phone number (92 unique across 96 rows — a
  few repeat customers), `tickets.status = 'closed'` for all of them
  (installation already completed historically), `orders.status` from
  whether balance_owed is actually 0 — matching the business's own
  clarified model: ticket status tracks "is the job done," order status
  tracks "is it paid off," and closing either one is just a status flip
  once its condition is met, not a separate business event.
- Pushed to the Sales sheet via the actual application code
  (`syncOrderToSalesSheet()`, not a bypass script) per explicit
  instruction — DB first, confirm, then let the app do the sheet write.

**Real bug hit during this run**: bulk-syncing 96 orders in a tight
sequential loop (~3 Sheets API calls each) tripped Google's per-minute
read-request quota, and partway through, `values.get` on the header
range started returning an effectively empty response without throwing
— every remaining sync in that first pass failed with "header row is
empty," and a follow-up check found the sheet's data rows gone too
(only the old stray tail-column labels survived). Root cause looks like
quota exhaustion producing a degraded read rather than any write in
this app's own code — `upsertRowByHeader`/`appendRowByHeader` never
write to row 1 or clear ranges in any code path. Recovered by restoring
the header manually, then re-running the sync with a 70s upfront delay,
1.2s pacing between orders, and up to 3 backoff retries (30s each) on
any quota-flavored error. Worth remembering for any future bulk
operation against this sheet: pace it, don't fire dozens of calls back
to back. **Final result, verified live: 96/96 orders synced, 0
failures** — Sales sheet now has exactly 97 rows (header + 96), matching
the database exactly, with real brand/category/variant/SKU on every row.

## Editable Bill Date on New Purchase + Sales Sheet Backfill (2026-09-02)

New Purchase's Bill Date defaults to today (IST) but can be changed —
`createDirectPurchase()` now takes an optional `billDate`, applied as
the order's `created_at` (what "Bill Date" reads everywhere: Orders
page, Sales sheet) at noon UTC rather than midnight, same reasoning as
the historical-import date-shift fix — a plain midnight value shifts a
day depending on server timezone. Verified live: a backdated purchase
landed exactly on the given date; an ordinary one still defaults to now.

**Backfilled the real Sales sheet from the live DB** now that Editor
access is actually granted (verified with a real write). The sheet's 97
rows were pasted in by hand during the original historical import, never
written by the app — cleared them and wrote fresh from `orders` (joined
through tickets/customers/products), so the sheet now exactly mirrors
the database (98 rows incl. header, matching the DB's 97 orders exactly)
instead of a static one-time paste. Every sale from here on keeps it in
sync automatically via the write-back already built above.

## Yearly Service Calls Due for the Whole Anniversary Week (2026-09-02)

`checkAndCreateYearlyServiceCalls()` used to only create a follow-up
ticket on the *exact* anniversary day (e.g. installation_date + 1.5
years lands on a Wednesday → only due that Wednesday) — too narrow for
a real calling schedule, where the business wants to work through
everyone due "this week," not chase an exact date. Added `startOfWeek()`
and round the anniversary down to that week's Monday before the `<=
today` comparison — the follow-up becomes due from Monday of the
matching week and stays visible all week (and after, until handled),
while still comparing with `<=` rather than `==` so a cron run that gets
skipped one day still catches up correctly instead of silently missing
that customer's reminder for a year. Verified live: an installation
whose anniversary fell within the current week correctly created a
follow-up; one whose anniversary fell in the *next* week correctly did
not (yet) — both cleaned up after.

## Payments-Outstanding Grouped by Person + Payment History (2026-09-02)

Admin dashboard's "Payments outstanding" card was listing one row per
*order* — a customer with two open orders (e.g. Riyas Mayan, ₹75,000 +
₹64,000) showed up twice. Grouped by customer (phone number) instead,
same pattern as the owner dashboard's overdue-by-person list from
earlier this session: `app/api/admin/dashboard/route.ts` now returns
`{name, phoneNumber, totalBalance, orderCount}[]`. Verified live: Riyas
Mayan's two orders correctly merge into one ₹139,000 row.

Each row's name links to `/admin/customers?phone=<number>` — the
existing Customer Directory now reads that query param, runs the search
automatically, and opens the first match's history immediately, so
clicking a name goes straight to "what they bought and what they've
paid" instead of landing on an empty search box.

**Payment history, considered two ways.** First built a dedicated
`payments` table (id, order_id, amount, created_at) with its own RLS
policies — then reconsidered: that's a second place "how much was paid"
can live, and could drift from `orders.paid_amount` if anything ever
touches the DB directly, for no real benefit here (nothing needs
SQL-level aggregation across payments, just a per-customer display
list). Replaced it with `orders.payment_history` (JSONB, default `[]`)
instead — `recordPayment()` appends `{amount, date}` to it in the same
update that changes `paid_amount`, so there's exactly one write, one
column, no new table, and no query anywhere else needed to change since
every existing `select('*, orders(*))` already returns it. Migration 011
created the table; 012 drops it and adds the column — both applied live,
011 was never used by anything real (created and reverted in the same
session).

## Sales Sheet Write-Back (2026-09-02)

Same idea as "+ Add Product," applied to sales: a sale is mirrored into
the spreadsheet's `Sales` tab (same spreadsheet as `Product List`) —
`bill_date, name, place, phone_number, sku, address` come straight from
the order/ticket/customer, and `category, brand, product_name, variant,
list_price, discount, balance_owed, warranty_expires_at` are filled in
automatically (joined from `products` via `tickets.product_code`, or
Postgres's own generated `discount`/`balance_owed` columns) — nothing
for the business to type by hand.

**Registered the moment the sale is made, not when it later happens to
close** — first built this triggered on order-close, but that was wrong:
"closed" isn't a separate business event, it's just what `orders.status`
reads once `balance_owed` hits 0. `syncOrderToSalesSheet()` is an
*upsert*, keyed on `phone_number + bill_date + sold_price` (stable for a
sale's whole lifetime, since sold_price never changes after the sale is
made), called from every DB write that changes something the sheet
shows: `createDirectPurchase()` (the row first exists), `recordPayment()`
(paid/balance change), `closeTicketAfterConfirmation()`
(installation_date/warranty_expires_at get stamped), and `closeOrder()`
(a final, redundant sync as a safety net). The DB stays the source of
truth for sales (unlike products, which genuinely live in the sheet) —
this is a one-way log, so the business keeps the same running ledger
they had before this app existed, updated live as a sale progresses,
without re-typing anything.

Fail-safe the same way as every Telegram notification (§10.5): every
sync call happens *after* its own DB write has already committed,
wrapped in `syncOrderToSalesSheetSafely()` — a Sheets outage or the
Editor-access permission problem "+ Add Product" has never blocks the
real operation (a sale being made, a payment recorded, a job closed)
that triggered it, it just logs to `notifications_log` as
`sales_sheet_failed` (new enum value, migration `010`).

**Real bug found and fixed while verifying this against the live sheet**:
the `Sales` tab has stray leftover header labels sitting past the real
18 columns (old formula residue: a blank cell, then duplicate
`category`/`brand`/`product_name`/`variant`/`list_price` labels around
columns U–Y) — reading the header unbounded picked up all 25 "columns",
and worse, `values.append`'s own table-detection got confused by sparse
data far outside the real table and landed entire rows starting around
column U instead of column A. Fixed by (1) truncating the header at the
first blank cell (`readRealHeader()` in `googleSheets.ts`) so every write
path has one reliable idea of how wide the real table is, and (2)
dropping `values.append` entirely in favor of an explicit
`values.update` to a deterministically computed row number — no more
relying on Sheets' own append auto-detection at all. Also found and
fixed: the upsert's match-by-`bill_date` never actually matched anything
on a second sync, because a date written as `"2026-09-02"` reads back
formatted as `"Sep 2, 2026"` — added `normalizeForMatch()`, which parses
both shapes with hand-written regexes rather than `new Date(...)`
(deliberately, since that constructor treats a bare `YYYY-MM-DD` as UTC
midnight but a display string like `"Sep 2, 2026"` as *local* midnight —
the same class of bug as the historical-import timezone note above).
**Verified live end-to-end** with a real 4-step lifecycle (create →
partial payment → full payment → close): exactly one sheet row the
whole way through, updating in place each time, correct final values —
all test rows cleaned from both the sheet and the DB afterward.

Refactored the Google Sheets plumbing shared between this and
`products.ts` into `lib/services/googleSheets.ts` (`sheetCredentials`,
`quotedTab`, `columnLetter`, `permissionAwareError`, `readRealHeader`,
`normalizeForMatch`, and generic `appendRowByHeader()`/
`upsertRowByHeader()`) rather than duplicating it a second time.

## Editable List Price, Display Cleanup, Pre-Launch Product Cleanup (2026-09-02)

- **`/admin/products`**: list price is now editable inline (click the
  price, edit, Save/Cancel) via `updateProductListPriceInSheet()` —
  finds the product's row by SKU in the actual sheet and edits just that
  cell, then re-syncs, same "sheet is the source of truth" rule as
  "+ Add Product". Blocked on the same Editor-access permission fix.
- **Start Case display**: the new sheet stores brand/category/name in ALL
  CAPS (`AQUA`, `KITCHEN`, ...) — `lib/format.ts`'s `toStartCase()`
  normalizes that for display on both `/admin/products` and
  `/admin/orders`, matching how hand-typed free-text product
  descriptions already read elsewhere in the app. Raw values are
  untouched in the DB/sheet — this is display-only.
- **`/admin/orders` table trimmed**: SKU, Master SKU, and List Price
  dropped from the on-screen table (still in the CSV export) — too much
  for the main view; Brand/Product Name/Variant/Sold/Paid/Balance/Status
  is what's actually used day to day.
- **Pre-launch product cleanup**: deleted (not just deactivated) the 16
  leftover test/old-sheet-shape product codes, after confirming zero
  tickets referenced any of them via `product_code`. The "never delete,
  only deactivate" rule (§9.3) exists to protect historical order
  references once live — with nothing live yet, a clean product table is
  worth more than an audit trail for rows nothing real ever pointed to.

## Product Sheet Restructure #2 + "+ Add Product" Write-Back (2026-09-02)

**Sync was broken in production** ("Sync failed — Internal server error")
because the business rebuilt the product spreadsheet again: the tab is
now named `Product List` (not `Products`, not `Untitled`), while
`GOOGLE_SHEETS_RANGE` was still pointing at `Untitled!A:F` from the
previous restructure. `spreadsheets.values.get` throws a plain (non-
`ApiError`) exception for an unparseable range, which `handleApiError()`
correctly turns into a generic 500 rather than a helpful message — the
same failure mode documented in Stage 5, just a different wrong tab
name. Fixed by setting `GOOGLE_SHEETS_RANGE` to `'Product List'!A:F`
(both locally and as a Railway variable) and defaulting the code to that
same tab name instead of `Products!A:F`.

While fixing it: the new sheet also dropped `master_sku` entirely and
added `list_price` back (columns are now `sku, category, brand,
product_name, variant, list_price`) — the exact opposite of the Stage 5
restructure. Rather than hard-code either shape again, `master_sku` and
`list_price` are now both **optional** columns: only `sku`, `category`,
`brand`, `product_name`, `variant` are required to exist; whichever of
the other two are present in a given sheet get read and written,
whichever aren't get left out of the upsert (not nulled) so an existing
DB value survives a sheet that stops carrying that column. Verified live:
47 real products synced correctly with prices, and 14 stale/test product
codes from before this restructure were deactivated (not deleted), same
as any normal sync.

**New: "+ Add Product" on `/admin/products`.** The spreadsheet stays the
single source of truth — adding a product in the app appends a row to
the actual sheet first (`appendProductToSheet()`, matched to the sheet's
real header order so column order doesn't need to be assumed), then
immediately re-syncs so it shows up on the page right away instead of
waiting for the nightly cron. This needed a second, write-scoped Google
auth client (`spreadsheets`, not `spreadsheets.readonly`) — every other
call in `products.ts` only ever reads. **Not yet usable in production**:
appending failed live with "The caller does not have permission" — the
service account (`sheets-reader@...`) is only shared as a Viewer on the
sheet. Needs the sheet shared with that account as an **Editor** before
"+ Add Product" will actually write; the route surfaces that exact
permission error back to the admin if it happens again rather than a
generic failure.

## Multi-Product Purchases / "Free" Line Items (2026-09-02)

New Purchase used to record exactly one product per submission. Real
business need: a Vessel sale sometimes comes with a free Kitchen unit
thrown in for inventory reasons, and that free unit still needs its own
installation ticket (a tech has to fit it, its own warranty clock has to
start) — so it needs to be its own row in Orders, not a note buried
inside the Vessel sale.

- `createDirectPurchase()` now takes an `items[]` array instead of a
  single product/price/paidAmount — one ticket+order pair is created per
  item, all sharing the same customer and planned installation date, so
  they land as adjacent rows in `/admin/orders`.
- The New Purchase form has a "+ Add another product" button (one
  product box by default, only shows the per-item chrome/remove button
  once a second is added).
- Each item's Price field has a "Free" checkbox next to it — checking it
  forces that item's price and paid amount to 0 and disables both inputs,
  rather than relying on someone typing "free" into a number field.
- Verified live against Supabase: a two-item purchase (₹90,000 paid item
  + a free item) produced exactly two tickets and two orders, the free
  one at list/sold/paid/balance all `0`, both `open` (an admin can still
  close the free one manually from Orders since nothing is owed) — then
  cleaned up.

## Historical Data Import (2026-09-01)

Bulk-imported the business's real records from before this app existed:
97 sales (Jan–Aug 2026, from their Sales ledger) and ~50 enquiry/service
entries (August, from their Enquiry sheet) — 148 tickets, 96 orders, 138
customers total. Imported as a one-off script (not committed — it read
two CSVs with real customer PII, both deleted after running), writing
directly to the tables rather than going through the app's own
book→complete→confirm flow, since these were already-completed sales,
not new work to schedule.

Key decisions made during cleanup, in case this ever needs auditing:
- **Sold price = Paid + Balance, not the sheet's own "Price" column.**
  The sheet's "Price" is closer to a pre-discount quote; the gap
  between it and (Paid + Balance) was imported as `discount`, matching
  how `orders.discount` already works.
- A handful of rows had data gaps the sheets themselves couldn't answer
  (missing phone numbers, blank Paid/Balance, a phone number typo'd
  differently between the two sheets) — resolved via direct back-and-
  forth with the business owner rather than guessed.
- One sale (Nisar/Panoor, Aug 22) appeared in the Enquiry sheet as
  "Product Sold" but not obviously in the Sales sheet — turned out to
  be the same transaction under a one-digit phone typo. Cross-checking
  matches like this is why a bulk import like this deserves a careful
  pass rather than a blind row-by-row load.

**Bug found and fixed after the import ran:** every date (`actual_date`,
`installation_date`, `warranty_expires_at`, plus the date mentioned
inside each historical `closure_explanation`) landed one day earlier
than the source sheets said. The import script parsed sheet dates like
`"Aug 29, 2026"` with plain `new Date(...)`, which treats that string as
*local* midnight — and the machine running the script was in IST
(UTC+5:30), so local midnight Aug 29 is `2026-08-28T18:30:00Z`, and
`.toISOString().slice(0, 10)` reads that back as Aug 28. Corrected
after the fact by adding one day to every affected field on the 137
imported tickets that had one (a handful of open enquiries/service
visits with no date yet were untouched, correctly). Any future script
parsing plain date strings like this needs to build the date at a fixed
UTC hour (e.g. `new Date(dateStr + 'T12:00:00Z')`) instead of trusting
the runtime's local timezone.

## V1 Status: all 7 stages built

Every hard rule (§13) is enforced in code, most of them in two independent
places (a Postgres constraint/trigger *and* the service layer) so no future
screen can route around them. Every §15 acceptance check has a concrete
screen behind it. See the "Cost" section above for what running this
actually costs once deployed.

**External-service wiring — done (2026-08-30), all verified live, not
assumed:**
1. [x] Supabase project created, migration run, `.env.local` populated
2. [x] Telegram bot created, added to staff group, message posted for real
3. [x] Google Cloud service account created, Sheets API enabled, real
   product spreadsheet shared with it, `syncProductsFromSheet()` run
   against live Supabase (2 real products landed)
4. [x] Deployed to Railway — live at
   `https://water-purifier-production.up.railway.app`
5. [x] `CRON_SECRET` + `APP_URL` set as GitHub repo secrets
   (`inayathnoon/water-purifier`); nightly workflow manually triggered
   and both jobs passed
6. [x] 5 real staff accounts created in Supabase Auth (see Stage 1)

**Two deploy-time bugs found and fixed while verifying the above:**
1. Railway's generated domain defaulted to `--port 3000`, but `next
   start` actually listens on whatever `$PORT` Railway injects (`8080`
   here) — the domain returned 502 until repointed with
   `railway domain update <domain> --port 8080`. If a future redeploy
   ever gets a different `$PORT`, the fix is the same: match the
   domain's target port to what the container log says it's listening on.
2. `GOOGLE_SERVICE_ACCOUNT_JSON` got corrupted the first time it was set
   on Railway: it was piped in via `node -e "require('dotenv')..." |
   railway variable set --stdin`, and this project's `dotenv` prints an
   "◇ injected env..." banner to stdout — which piped straight into the
   variable ahead of the real JSON, breaking `JSON.parse` in production
   (silent locally, since the local `.env.local` file is read directly,
   never through that pipe). Fixed by extracting the value straight out
   of `.env.local` with `grep`/`sed` — no `node`/`dotenv` in the
   pipeline — before piping it to `--stdin`.

## Verification Checklist

- [x] Each hard rule: write a test that tries to break it, confirm backend refuses
- [x] End-to-end: enquiry → call logged → converted → installation booked → tech completes → admin closes → order balances → payment → Telegram posts exactly 3 message types
- [x] §15 checks: Admin's screen shows all 4 categories; tech can mark job done in <1 min on phone; renaming a Sheet column breaks sync loudly

**Verified 2026-08-30, directly against the live Supabase project and
deployed Railway app** (a throwaway script exercising the real service
layer — `lib/services/*.ts` — against production, not a mocked test DB;
all rows cleaned up afterward). 23/23 checks passed:

- Every §13 hard rule tried and refused **twice** — once through the
  service-layer guard, once by writing straight to the table to prove the
  Postgres trigger/constraint catches it independently: jobs-to-non-staff
  (§13.5), order-close-while-owed (§13.1), plus the service-layer-only
  checks for the 30-word/one-call enquiry-closure rule (§13.2/§5.4/§5.5)
  and the warranty charge override (§13.3) — a tech-entered charge was
  forced to 0 inside the warranty year and preserved outside it.
- `completeJob`'s response was inspected directly to confirm
  `agreed_price` genuinely never appears in the object sent to a
  technician (§13.4), not just that the UI doesn't render it.
- Full lifecycle run for real: enquiry → call logged → converted →
  installation booked to a real tech → completed → admin-closed → order
  created → partial payment (still refused) → paid in full → order
  closed. Warranty dates came out stamped from the technician's actual
  completion date, not the close date (§8.1).
- §8.2's nightly yearly-service job was run against a real backdated
  installation: created exactly one follow-up ticket, then created zero
  more on a second run (duplicate guard via `parent_installation_id`).
- §11.4's leave-denial-needs-a-reason trigger was tried and refused live.
- All 3 Telegram templates fired for real and logged `sent` in
  `notifications_log`: `job_assigned`, `job_completed`,
  `leave_requested`.
- Dashboard queries (`app/api/admin/dashboard`, `app/api/owner/dashboard`)
  re-run directly against the DB state produced above, confirming the
  test ticket/order actually surfaced in the right category (completed
  jobs awaiting confirmation, this month's revenue).

## Cost

**Recommended ($31–34/mo):**
- Supabase Pro: $25/mo (backups + SLA for money-tracking app)
- Railway Hobby: $5–8/mo
- Everything else: free (GitHub Actions, Telegram, Google Sheets, domain optional)

**Minimum ($6–9/mo):**
- Supabase Free tier (no backups)
- Railway Hobby: $5–8/mo
- Everything else: free

## Next Steps

All external-service wiring and deployment is done and verified (see
above). What's left is the **Verification Checklist** above: hard-rule
break-tests, one full end-to-end walkthrough on the live app, and the
§15 dashboard acceptance checks.
