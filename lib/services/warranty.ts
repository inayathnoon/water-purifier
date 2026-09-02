import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

/**
 * §8.2 (revised 2026-09-02): follow-up service calls repeat on every
 * *half* anniversary after the first year — 1.5 years post-install, then
 * 2.5, then 3.5, and so on — not once at the 1-year warranty mark. The
 * plain 1-year check is gone entirely; §13.3's "no charge inside the
 * warranty year" rule is untouched (still keyed off installation_date in
 * completeJob()), and every one of these reminders now lands safely
 * outside that first year by construction, so a tech's entered charge
 * is never ambiguous.
 *
 * How many of these an installation has already had is just a count of
 * its existing follow-up tickets (via parent_installation_id) — the
 * Nth follow-up is due at installation_date + (1.5 + N) years, where N
 * is how many came before it.
 *
 * Runs nightly (see app/api/jobs/yearly-service-check/route.ts).
 */
export async function checkAndCreateYearlyServiceCalls(): Promise<{ created: number; ticketIds: string[] }> {
  const today = new Date();

  const { data: installations, error: findError } = await supabaseAdmin
    .from('tickets')
    .select('id, customer_id, installation_date')
    .eq('kind', 'installation')
    .eq('status', 'closed')
    .not('installation_date', 'is', null);

  if (findError) throw new ApiError(500, findError.message);
  if (!installations || installations.length === 0) return { created: 0, ticketIds: [] };

  const { data: existingFollowUps, error: followUpError } = await supabaseAdmin
    .from('tickets')
    .select('parent_installation_id')
    .eq('kind', 'service_visit')
    .in(
      'parent_installation_id',
      installations.map((i) => i.id)
    );
  if (followUpError) throw new ApiError(500, followUpError.message);

  const followUpCounts = new Map<string, number>();
  for (const f of existingFollowUps ?? []) {
    if (!f.parent_installation_id) continue;
    followUpCounts.set(f.parent_installation_id, (followUpCounts.get(f.parent_installation_id) ?? 0) + 1);
  }

  const due = installations
    .map((installation) => {
      const priorVisits = followUpCounts.get(installation.id) ?? 0;
      const nextDue = new Date(installation.installation_date as string);
      nextDue.setMonth(nextDue.getMonth() + Math.round((1.5 + priorVisits) * 12));
      return { installation, nextDue };
    })
    .filter(({ nextDue }) => nextDue <= today);

  if (due.length === 0) return { created: 0, ticketIds: [] };

  const { data: created, error: createError } = await supabaseAdmin
    .from('tickets')
    .insert(
      due.map(({ installation, nextDue }) => ({
        customer_id: installation.customer_id,
        kind: 'service_visit' as const,
        status: 'open' as const,
        parent_installation_id: installation.id,
        installation_date: installation.installation_date,
        // Repurposed as "this reminder's due date", not a real warranty
        // date — the admin dashboard sorts the due-calls list by this
        // column, soonest first; nothing reads it as an actual warranty.
        warranty_expires_at: nextDue.toISOString().slice(0, 10),
      }))
    )
    .select('id');

  if (createError) throw new ApiError(500, createError.message);
  return { created: created?.length ?? 0, ticketIds: (created ?? []).map((t) => t.id) };
}

/** §8.6: if the customer declines, that's recorded too — no service_visit gets booked. */
export async function declineYearlyService(ticketId: string, note: string) {
  if (!note.trim()) throw new ApiError(400, 'A note on why the customer declined is required');

  const { data: ticket, error: findError } = await supabaseAdmin
    .from('tickets')
    .select('kind, status')
    .eq('id', ticketId)
    .single();
  if (findError || !ticket) throw new ApiError(404, 'Ticket not found');
  if (ticket.kind !== 'service_visit' || ticket.status !== 'open') {
    throw new ApiError(400, 'Not an open yearly-service ticket');
  }

  await supabaseAdmin.from('call_log').insert({ ticket_id: ticketId, note });

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update({ status: 'closed', service_declined: true })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  return data;
}
