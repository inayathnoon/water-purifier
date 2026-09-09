# Removed: staff self-service portal (2026-09-09)

## What existed

Technicians (service_staff accounts) logged into the app directly:

- `/staff/jobs` — today's/upcoming assigned jobs, a "Mark Done" form
  (notes, a live spare-parts picker with a running total, §13.3's
  in-warranty-free override applied client-side as a preview), a §8.4
  "Edit" window to fix a mistake for up to 7 days after a completed
  service visit (with `tickets.edit_history` recording what was
  overwritten and by whom), and a "last 30 days" history view.
- `/staff/time-off` — request leave (dates + reason), see your own past
  requests.
- Backing API routes: `/api/staff/jobs`, `/api/staff/jobs/[id]/complete`,
  `/api/staff/jobs/[id]/edit`, `/api/staff/leave`.
- `completeJob()` accepted `partsUsed`/`chargeAmount`/`chargeBreakdown`
  directly on the ticket, forcing them to 0/`[]` inside the warranty year;
  `editCompletedServiceVisit()` let a tech correct those fields afterward.

## Why removed

Business decision: go back to informal Telegram coordination for "what's
my job" rather than a per-tech login — a 3-person field team, in
practice, didn't need a separate app surface for this. Admin now records
what happened once the tech reports back by phone/Telegram, from the
dashboard's existing "Finished Installation/Service" card.

## What replaced it

- `notifyJobAssigned()` (Telegram, unchanged mechanism, `bookJob()`)
  already carried address/date/half-day/location — it now also includes
  `issue_note` for an ad-hoc Service Call, since `/staff/jobs`'s
  "Reported problem" box was previously the *only* place a tech ever saw
  that (a 2026-09-06 bug fix — removing the page without this addition
  would have silently reintroduced it).
- `POST /api/admin/tickets/[id]/mark-done` — admin's "Installed"/"Service
  completed" step, calling the same `completeJob()` (now accepting only
  `actualDate`/`actualStartTime`/`actualEndTime`/`notes` — the ticket's
  own `assigned_to_id` is passed as the caller, not the admin's own id, so
  the notification still names the real technician). Always stamps
  *today* as `actual_date` — no backdating field, since there's no tech
  on hand to say when the visit actually happened.
- Spare parts sold now go through **Sell Spare Part**
  (`/admin/spare-parts?ticketId=...`), linked via the new
  `spare_part_sales.ticket_id` column (migration 035) instead of the
  ticket's own `charge_breakdown`. `recordSparePartSale()` re-derives
  §13.3's in-warranty-free check itself when a `ticketId` is given —
  this flow had no warranty concept at all before this change.
- Leave requests: `POST /api/admin/leave` + `/admin/leave` (admin picks
  the staff member and dates on the tech's behalf) — `requestLeave()`
  itself is unchanged, it never assumed the requester was the caller.

## What would need reactivating, if this is ever brought back

1. `git checkout pre-staff-portal-removal -- app/staff lib/services/tickets.ts app/api/staff` —
   the tag `pre-staff-portal-removal` marks the last commit before this
   removal.
2. Re-add `partsUsed`/`chargeAmount`/`chargeBreakdown` to `completeJob()`
   and reintroduce `editCompletedServiceVisit()` (both still exist in the
   tag's history) — decide whether spare parts should move back onto the
   ticket itself or keep the `spare_part_sales.ticket_id` linkage added
   here (probably the latter — it's a real improvement independent of
   who's filling the form).
3. `tickets.edit_history`, `tickets.parts_used`, `tickets.charge_amount`,
   `tickets.charge_breakdown` were left in the schema, unused but intact
   — no migration needed to bring the columns back, only the code that
   reads/writes them.
4. Re-add `service_staff`'s redirect in `app/dashboard/page.tsx` and the
   branch in `app/api/tickets/[id]/redirect-target/route.ts`.
