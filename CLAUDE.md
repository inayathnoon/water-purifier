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
2. **Enquiry closure needs 30+ words & ≥1 prior call** → Server-side validation in `/api/admin/enquiries/close`
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
         installation is only ever followed up once
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

## V1 Status: all 7 stages built

Every hard rule (§13) is enforced in code, most of them in two independent
places (a Postgres constraint/trigger *and* the service layer) so no future
screen can route around them. Every §15 acceptance check has a concrete
screen behind it. See the "Cost" section above for what running this
actually costs once deployed.

**Before this is genuinely live**, the remaining work is entirely
external-service wiring, not code:
1. Create the Supabase project, run the migration, populate `.env.local`
2. Create Telegram bot via @BotFather, add to the staff group, get its chat id
3. Create a Google Cloud service account with Sheets read access, share
   the actual product spreadsheet with it
4. Deploy to Railway, point `APP_URL` at the real deployment
5. Set the `CRON_SECRET` + `APP_URL` GitHub repo secrets so the nightly
   Actions workflow can reach the deployed app
6. Create the 5 real user accounts in Supabase Auth

## Verification Checklist

- [ ] Each hard rule: write a test that tries to break it, confirm backend refuses
- [ ] End-to-end: enquiry → call logged → converted → installation booked → tech completes → admin closes → order balances → payment → Telegram posts exactly 3 message types
- [ ] §15 checks: Admin's screen shows all 4 categories; tech can mark job done in <1 min on phone; renaming a Sheet column breaks sync loudly

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

1. Create a Supabase project (https://supabase.com)
2. Populate .env.local with Supabase URL/keys
3. Run the migration (`001_init_schema.sql`) in Supabase SQL editor
4. Create 5 user accounts via Supabase Auth console or SQL
5. Start Stage 2: Enquiry flow
