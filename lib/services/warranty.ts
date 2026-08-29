import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

/**
 * §8.2: one year after installation, the customer appears on the admin's
 * call list to ask whether service is needed. This runs nightly (see
 * app/api/jobs/yearly-service-check/route.ts) and creates one open
 * service_visit ticket per installation whose warranty has just expired —
 * guarded by parent_installation_id so a installation is only ever
 * followed up once, however many nights the cron runs after that date.
 */
export async function checkAndCreateYearlyServiceCalls(): Promise<{ created: number; ticketIds: string[] }> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: dueInstallations, error: findError } = await supabaseAdmin
    .from('tickets')
    .select('id, customer_id, installation_date, warranty_expires_at')
    .eq('kind', 'installation')
    .eq('status', 'closed')
    .lte('warranty_expires_at', today);

  if (findError) throw new ApiError(500, findError.message);
  if (!dueInstallations || dueInstallations.length === 0) return { created: 0, ticketIds: [] };

  // Exclude installations that already have a follow-up ticket.
  const { data: existingFollowUps, error: followUpError } = await supabaseAdmin
    .from('tickets')
    .select('parent_installation_id')
    .eq('kind', 'service_visit')
    .in(
      'parent_installation_id',
      dueInstallations.map((i) => i.id)
    );
  if (followUpError) throw new ApiError(500, followUpError.message);

  const alreadyHandled = new Set((existingFollowUps ?? []).map((f) => f.parent_installation_id));
  const toCreate = dueInstallations.filter((i) => !alreadyHandled.has(i.id));

  if (toCreate.length === 0) return { created: 0, ticketIds: [] };

  const { data: created, error: createError } = await supabaseAdmin
    .from('tickets')
    .insert(
      toCreate.map((installation) => ({
        customer_id: installation.customer_id,
        kind: 'service_visit' as const,
        status: 'open' as const,
        parent_installation_id: installation.id,
        // Carried forward so a later charge determination (§8.5) on *this*
        // visit still measures from the original fit date.
        installation_date: installation.installation_date,
        warranty_expires_at: installation.warranty_expires_at,
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
