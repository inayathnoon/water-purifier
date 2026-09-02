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

## Ad-Hoc "New Service" Form + Historical Service Import (2026-09-02/03)

**"+ New Service" now opens a real form**, not just a link to the
due-list page — for a customer calling in with a problem any time, not
tied to the 18-month schedule (that flow is still the "Mark service
requested" button on the due-this-month list, unchanged). Same shape as
New Enquiry: `CustomerFields` + a product dropdown + a required issue
note, creating an **open** `service_visit` ticket with no
`parent_installation_id` — deliberately not linked to an installation,
since linking an ad-hoc repair call would corrupt the yearly-due cycle
counting (`getYearlyServiceDueThisMonth()` counts every `service_visit`
against `parent_installation_id` to know which cycles are already
handled).

**New Service sheet sync** (`lib/services/serviceSheet.ts`, mirroring
`salesSheet.ts`): every service_visit ticket is pushed to the
spreadsheet's `Service` tab on creation, decline, and confirm-close —
matched on `phone_number + date`, upserted in place as it moves through
its lifecycle. New `service_sheet_failed` event type (migration 015)
for fail-safe logging, same shape as every other sheet sync.

**Imported 42 historical service rows** from the real `Service` tab
(discovered while building this — the business had been tracking ad-hoc
repair calls there all along). Same care as the Sales/Enquiry imports:
cross-checked all 40 unique phone numbers against existing customers (2
already on file — Bright School, Anwer Sadik — linked to those; 37 new),
applied the same precedents already set for this kind of data (Farhan's
stray `91` country-code prefix stripped; a blank-phone row and a
blank-name row skipped, matching the Enquiry import's exact precedent
for those same two categories of bad row). Rows with no recorded stage
imported as still-open (unresolved).

**Real bug hit and fixed during the sheet sync**: `Farhan`'s corrected
phone number changed his match key, so the sync couldn't find his
original sheet row and inserted a new one instead of updating in place
— leaving both the stale (wrong-phone) and corrected rows sitting side
by side. Not a code bug so much as an inherent limit of phone-based
matching when the phone itself is the thing being corrected; caught it
by diffing the sheet's row count against expectations, deleted the
stale row directly. Final state verified directly: 45 sheet rows (1
header + 44 data, matching the original sheet's count exactly — 41
matched-and-updated in place, 1 corrected Farhan, 2 untouched skip-rows)
and exactly 42 service_visit tickets in the database.

## Yearly Service: From Nightly Cron to Admin-Driven "New Service" (2026-09-02)

Replaced the whole mechanism, not just the schedule. Previously a
nightly cron auto-created a `service_visit` ticket once an installation
crossed its due week. Now: due-ness is a **plain read-time query**
(`getYearlyServiceDueThisMonth()`), and creating the actual ticket is an
**explicit admin action** ("Mark service requested" → `createServiceRequest()`)
— nothing runs in the background for this any more. The nightly
GitHub Actions job and `/api/jobs/yearly-service-check` are both removed.

**The due-this-month rule, worked out from the business's own framing**
("18 months ago, 30, 42, 56, ... 152" — every 12 months after the first
18): because every step is exactly 12 months apart, the due *calendar
month* never changes for a given installation — only the year does. So
"due this month" reduces to: is this month exactly 6 months on from the
install month, has it been ≥18 months, and hasn't this specific cycle
already been requested (tracked the same way as before, by counting
existing `service_visit` tickets with this `parent_installation_id`,
regardless of their status — even a declined one counts as "handled"
for that cycle). Sorted newest-installation-first, per the business's
own stated read order.

- `/admin/service-calls` now has two sections: "Due this month" (the
  computed list, each row has a **"Mark service requested"** button —
  the "New Service" action, mirroring "+ New Enquiry"/"+ New Purchase")
  and "Requested — booking or in progress" (the existing open-tickets
  list, unchanged — booking a tech onto a requested service already
  worked exactly like booking an installation).
- Admin dashboard's "Yearly service calls due" card now shows this same
  computed list instead of querying open tickets (there usually
  wouldn't be any without the old cron); added a **"+ New Service"**
  dashboard button alongside New Enquiry/New Purchase.

**Verified live with synthetic backdated installations** (since none of
the 96 real reimported ones are old enough yet — all from 2026, at most
~8 months old): an 18-month-old install and a 30-month-old install both
correctly appeared (newest first), a 17-month-old one correctly did not;
requesting service for the 18-month one correctly removed it from the
due list while the 30-month one stayed — all test records cleaned up
afterward.

## Follow-Up Satisfaction Call Tracking (2026-09-02)

New, separate from Installation status: a follow-up satisfaction call
made sometime *after* installation is already confirmed — not "was the
job done right" (that's what stamps `installation_date`), but "checking
in a few weeks later." New `orders.confirmation_status`
(pending/completed, default `pending` — including all 96 reimported
orders, deliberately not backfilled as already-confirmed since no such
call was ever specifically logged for them), plus `confirmation_note`
and `confirmed_at`.

- Admin dashboard's "Confirm finished work" card now shows two kinds of
  entries: jobs still awaiting the original install-confirmation
  (unchanged), plus orders installed in the last 30 days still pending
  this new follow-up call — both link into `/admin/orders`.
- `/admin/orders`: new "Follow-up" column (Pending/Completed) and a "Log
  follow-up call" button (shown once an order is actually installed and
  still pending) that requires a 3+ word note before it'll save —
  mirrors §5.4/§5.5's word-count rule for enquiry closure, so this can't
  be clicked through as a bare formality.
- CSV export gained Follow-up Call Status/Note columns.

Verified live: rejected a 1-word note, accepted a real one and confirmed
`confirmation_status`/`confirmation_note`/`confirmed_at` all set
correctly (then reverted the test change on real data); the 30-day
window query correctly narrows the 96 reimported orders down to the 6
actually installed within the last 30 days.

## Orders: Split Payment/Installation Status (2026-09-02)

`/admin/orders` had a single "Status" column (the raw `orders.status`
enum — open/closed) but the business tracks two independent things:
whether the *money* is settled and whether the *job* is actually done —
a fully-paid order can still be sitting on an uninstalled unit, and vice
versa. Replaced it with two derived columns:

- **Payment**: Pending/Completed, straight off `balance_owed > 0`.
- **Installation**: Completed once `tickets.installation_date` is set;
  Pending (plain text) if the tech hasn't even finished the job yet; a
  **"Confirm date"** button once `tickets.status === 'completed'` (tech's
  marked it done, awaiting the admin's confirmation call) — clicking it
  calls the existing `/api/admin/tickets/[id]/close` endpoint
  (`closeTicketAfterConfirmation`), which stamps `installation_date` from
  the tech's own `actual_date` (§8.1) and starts the warranty clock. This
  reuses the confirmation flow that already existed elsewhere (dashboard
  card, `/admin/installations`) rather than adding a second, free-typed
  date field that could bypass the "warranty starts from the tech's
  actual visit" rule.

Verified live with a real booking→completion→confirmation sequence:
after the tech completes, `installation_date` is correctly still null
(Orders would show the Confirm button); after confirming,
`installation_date`/`warranty_expires_at` are stamped and status is
`closed` — matching exactly what the two derived columns are built to
read. CSV export gained the same two columns, replacing the old single
`Status` column.

## Auto-Generated SKU, "New Purchase" Naming, Address Casing (2026-09-02)

- **SKU is now generated, never typed.** `generateSku(brand, name, variant)`
  = `UPPER(no spaces/quotes)` for each of brand/name/variant, joined with
  `-`, variant omitted if blank — verified against the live catalog: 31
  of 47 existing codes match this exactly (e.g. `AQUA-JADE-UV`,
  `BLUEMOUNT-GRAVITY`); the other 16 diverge because whoever typed them
  by hand also made one-off editorial calls (dropped a parenthetical,
  folded the variant into the name for disambiguation) — expected, SKUs
  are immutable once created (§9.4), this only governs new ones. "+ Add
  Product" now shows a live SKU preview instead of an input, and the API
  refuses to add a product whose generated SKU already exists
  (case-insensitive) rather than silently duplicating.
- **"Installations" renamed to "New Purchase"** everywhere it's a page
  title or nav label — the page is reached almost entirely via the
  "+ New Purchase" action, so a heading that still said "Installations"
  after that redirect was a real inconsistency. The admin dashboard's
  plain nav link duplicated the adjacent "+ New Purchase" button once
  both said the same thing, so that redundant link was removed outright
  (the owner dashboard's link stays — it has no separate button next to
  it). The page's *content* below the form — a queue of installations
  awaiting booking — is untouched and still correctly described as such.
- **`customers.address` no longer forced uppercase.** The existing
  `normalize_customer_text()` trigger uppercased name/address/area
  together; business wants name and area normalized but address left
  exactly as typed. Migration `013` drops address from that trigger.
  Restored the 92 historical customers' addresses (already uppercased by
  the old trigger before this fix landed) back to their original mixed
  case from the source CSV, then re-ran the Sales-sheet sync so the
  sheet's address column matches. The Name field in `CustomerFields`
  (shared by New Purchase and New Enquiry) now forces uppercase as you
  type too, not just on save — Address is untouched.

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

## Full Regression Pass Before Staff Dashboard Work (2026-09-03)

Before starting any staff-dashboard changes, ran a 27-check regression suite
directly against the live service layer (`lib/services/*.ts`) and DB triggers
in production — same methodology as the original Stage-verification pass,
re-run now because several hard-rule-adjacent code paths (`parent_installation_id`,
`confirmation_status`, the yearly-service math) were added or changed after
that original pass. **27/27 passed**, covering:

- §13.1 (order-close-while-owed), §13.5 (job-assignment-to-non-staff), §11.4
  (leave-denial-needs-a-reason) — each tried at both the service-layer guard
  and by writing straight to the table, confirming the DB trigger/constraint
  catches it independently.
- §5.4/§5.5/§13.2 enquiry closure (word-count minimum, "must have called
  once" for pass-to-owner) and confirmation that a closed enquiry drops off
  the `status='open'` dashboard query used by both bulk-imported and
  individually-created enquiries.
- §13.3/§13.4 warranty override (in-warranty charge forced to 0, out-of-
  warranty charge preserved) and that `completeJob`'s response object has no
  `agreed_price`/`sold_price` key at all.
- New yearly-service due-list math (18-months-ago due, 17-months-ago not),
  `createServiceRequest` correctly removing an installation from the due
  list once requested, and `declineYearlyService`'s required-note rule.
- The ad-hoc "New Service" form producing a ticket with no
  `parent_installation_id` (so it can't corrupt the yearly-cycle counter),
  and the new order-satisfaction follow-up's 3-word-minimum note rule.

**Bug found in the test script itself, not the app** (documented since it's
a real trap worth knowing for any future cleanup script): `tickets.
parent_installation_id` has no `ON DELETE CASCADE`, so a cleanup routine
that deletes a parent installation ticket before its `service_visit`
children silently fails that one delete (Supabase's JS client doesn't throw
on a single failed row in a loop unless the error is checked) — leaving an
orphaned parent ticket, and in turn a customer row that then also can't be
deleted because the orphaned ticket still references it. Caught both times
by cross-checking table row counts against expectations before and after,
not by any thrown error. Doesn't affect the app itself — nothing in the UI
ever deletes an installation ticket — but worth remembering for any future
one-off script that touches `tickets` and `parent_installation_id` together.

**RLS re-confirmed statically** (no code change needed, but checked before
building the staff dashboard on top of it): `orders_read` restricts the
whole `orders` table to owner/admin, and `tickets_read` restricts
`service_staff` to rows where `assigned_to_id = auth.uid()` — so none of
this session's new columns (`confirmation_status`, `parent_installation_id`,
etc.) introduce any new price/status leak to technicians.

## Staff Job List: Distinguish Yearly Service from Ad-Hoc Service Calls (2026-09-03)

`/staff/jobs` already labelled a job "Installation" or "Service visit" but
couldn't tell a tech whether a service visit was a routine 18-month-and-up
warranty check-up or a customer's own reported problem — both looked
identical. Since `service_visit` tickets created off the yearly schedule
(`createServiceRequest` in `warranty.ts`) always carry `parent_installation_id`
and ad-hoc ones (`createAdHocServiceRequest`) never do, that field alone is
enough to tell them apart with no new column needed. `jobBadge()` in
`app/staff/jobs/page.tsx` now renders three distinct badges — Installation
(blue), Yearly Service (purple), Service Call (orange) — and
`/api/staff/jobs` was extended to select `parent_installation_id` (no
price/business-sensitive data in it, so no RLS concern). Verified live: a
real installation, a real yearly-service ticket (spawned from a backdated
closed installation via `createServiceRequest`), and a real ad-hoc request
all booked to the same technician and queried through the exact same
query the API route uses — came back Installation / Yearly Service /
Service Call in that order, then cleaned up.

## "Staff Attended" on New Service — Immediate Assignment (2026-09-03)

The "+ New Service" ad-hoc form gained a **Staff Attended** dropdown
(Yasir, Babu, Cristeen — pulled live from `/api/admin/staff`, the same
service-staff list the "book it" form on this same page already uses, not
hardcoded, so it stays correct if staff ever changes). Picking someone
books the ticket immediately — `assigned_to_id`, `status: 'booked'`,
today's date (`todayIST()`), the current half-day (new `halfDayNowIST()`
in `lib/dates.ts`), location defaulted to `home` — instead of making the
admin repeat the same assignment step from the "Requested" list right
after creating it. Left on "(not yet decided)", the ticket is created open
and unassigned exactly as before — this is additive, not a required field.

`createAdHocServiceRequest()` in `lib/services/tickets.ts` takes the new
optional `staffAttendedId` and, when given, delegates straight to the
existing `bookJob()` (so it goes through the exact same service_staff-only
validation and Telegram job-assigned notification as any other booking,
nothing new to enforce). Verified live both ways: with a staff pick, the
resulting ticket came back `booked`/assigned/dated correctly; without one,
`open`/unassigned, unchanged from before — both cleaned up after.

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
