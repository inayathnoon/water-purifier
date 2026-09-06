import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { todayIST } from '@/lib/dates';

// actual_date is a plain DATE column — string arithmetic on the IST
// calendar date avoids the timestamptz-threshold helpers built for
// created_at-style columns (slicing those to a date can land a day off,
// the exact class of bug documented elsewhere in this app).
function daysAgoDateString(days: number): string {
  const d = new Date(`${todayIST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// issue_note included: only ever set on an ad-hoc Service Call
// (createAdHocServiceRequest) — it's what actually tells a tech what's
// wrong with the unit before they show up. No price/business-sensitive
// data in it, so no RLS concern.
const SELECT =
  'id, kind, status, booked_date, booked_half_day, location, parent_installation_id, installation_date, actual_date, actual_notes, parts_used, charge_amount, issue_note, customers(name, address, area, phone_number)';

// §2.3: service staff see only their own jobs. Price/discount/balance
// columns live on `orders`, not `tickets`, and this query never touches
// that table — so there's nothing to accidentally leak here even without
// relying on RLS alone. charge_amount is a tech's own recorded amount
// for a chargeable visit (§8.4), not the sale price — already something
// they entered themselves, not new information for them.
export async function GET() {
  try {
    // 'developer' included so the Developer panel's "View As Staff"
    // preview works — a developer has no assigned tickets, so this
    // correctly comes back empty rather than leaking anyone else's jobs.
    const user = await requireUser(['service_staff', 'developer']);

    const [active, recentlyClosed] = await Promise.all([
      // Anything still open to act on — book to complete, or completed
      // and awaiting the admin's confirmation call.
      supabaseAdmin
        .from('tickets')
        .select(SELECT)
        .eq('assigned_to_id', user.id)
        .in('status', ['booked', 'completed'])
        .order('booked_date', { ascending: true }),

      // §8.4 mistake-fix window: a service visit the admin already
      // confirmed-and-closed stays visible (and editable, via
      // /api/staff/jobs/[id]/edit) for a week after the actual visit, so
      // a tech can go back and correct a wrong charge or forgotten part
      // without needing an admin to do it for them.
      supabaseAdmin
        .from('tickets')
        .select(SELECT)
        .eq('assigned_to_id', user.id)
        .eq('kind', 'service_visit')
        .eq('status', 'closed')
        .gte('actual_date', daysAgoDateString(7))
        .order('booked_date', { ascending: true }),
    ]);

    if (active.error) throw active.error;
    if (recentlyClosed.error) throw recentlyClosed.error;

    return Response.json({ jobs: [...active.data, ...recentlyClosed.data] });
  } catch (err) {
    return handleApiError(err);
  }
}
