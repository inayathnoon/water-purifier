import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { todayIST } from '../dates';
import { syncServiceToSheetSafely } from './serviceSheet';

/**
 * §8.2 (revised 2026-09-02, then again 2026-09-02): follow-up service
 * calls are due on every *half* anniversary after the first year — 18
 * months post-install, then 30, then 42, and so on, 12 months apart
 * forever. Because each step is exactly 12 months, the due *month*
 * never changes for a given installation (installMonth + 6, wrapping
 * around the year) — only the year does. So "due this month" is just:
 * is this calendar month exactly 6 months on from the install month,
 * has it been at least 18 months, and hasn't this specific cycle
 * already been requested.
 *
 * This used to be a nightly cron that auto-created the follow-up ticket
 * (see git history) — now it's a plain read-time query, and creating
 * the actual ticket is an explicit admin action (createServiceRequest
 * below), same as any other new job in this app. Nothing runs in the
 * background for this any more.
 */
export interface DueYearlyService {
  installationTicketId: string;
  customerId: string;
  customerName: string;
  phoneNumber: string;
  area: string;
  installationDate: string;
  monthsSinceInstall: number;
  productLabel: string | null;
}

function monthsBetween(fromYear: number, fromMonth: number, toYear: number, toMonth: number): number {
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

export async function getYearlyServiceDueThisMonth(): Promise<DueYearlyService[]> {
  const today = todayIST();
  const [todayYear, todayMonth] = today.split('-').map(Number);

  const { data: installations, error: findError } = await supabaseAdmin
    .from('tickets')
    .select('id, customer_id, installation_date, enquiry_product_interest, customers(name, phone_number, area)')
    .eq('kind', 'installation')
    .eq('status', 'closed')
    .not('installation_date', 'is', null);
  if (findError) throw new ApiError(500, findError.message);
  if (!installations || installations.length === 0) return [];

  const { data: existingFollowUps, error: followUpError } = await supabaseAdmin
    .from('tickets')
    .select('parent_installation_id')
    .eq('kind', 'service_visit')
    .in('parent_installation_id', installations.map((i) => i.id));
  if (followUpError) throw new ApiError(500, followUpError.message);

  // Every prior service_visit counts as "this cycle handled", whatever
  // its current status — requested-and-later-declined still means the
  // admin doesn't need to be asked again this cycle.
  const followUpCounts = new Map<string, number>();
  for (const f of existingFollowUps ?? []) {
    if (!f.parent_installation_id) continue;
    followUpCounts.set(f.parent_installation_id, (followUpCounts.get(f.parent_installation_id) ?? 0) + 1);
  }

  const due: DueYearlyService[] = [];
  for (const installation of installations) {
    const [instYear, instMonth] = (installation.installation_date as string).split('-').map(Number);
    const monthsSince = monthsBetween(instYear, instMonth, todayYear, todayMonth);
    if (monthsSince < 18) continue;

    const isDueMonth = (monthsSince - 18) % 12 === 0;
    if (!isDueMonth) continue;

    const cycleNumber = (monthsSince - 18) / 12 + 1; // 1st due cycle, 2nd, 3rd, ...
    const priorCount = followUpCounts.get(installation.id) ?? 0;
    if (priorCount >= cycleNumber) continue; // already requested this cycle

    const customer = installation.customers as unknown as { name: string; phone_number: string; area: string };
    due.push({
      installationTicketId: installation.id,
      customerId: installation.customer_id,
      customerName: customer.name,
      phoneNumber: customer.phone_number,
      area: customer.area,
      installationDate: installation.installation_date as string,
      monthsSinceInstall: monthsSince,
      productLabel: installation.enquiry_product_interest,
    });
  }

  // Newest installation first, per the business's own read of this list.
  due.sort((a, b) => b.installationDate.localeCompare(a.installationDate));
  return due;
}

/**
 * The admin's explicit action once they've decided to actually pursue a
 * due yearly service call — creates the real service_visit ticket
 * (open, unbooked), which then goes through the exact same book →
 * complete → confirm-and-close flow as any other service visit
 * (/admin/service-calls already handles all of that).
 */
export async function createServiceRequest(installationTicketId: string) {
  const { data: installation, error: findError } = await supabaseAdmin
    .from('tickets')
    .select('id, kind, status, customer_id, installation_date, enquiry_product_interest, product_interest, product_code')
    .eq('id', installationTicketId)
    .single();
  if (findError || !installation) throw new ApiError(404, 'Installation not found');
  if (installation.kind !== 'installation' || installation.status !== 'closed') {
    throw new ApiError(400, 'Not a closed installation');
  }

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .insert({
      customer_id: installation.customer_id,
      kind: 'service_visit',
      status: 'open',
      parent_installation_id: installation.id,
      installation_date: installation.installation_date,
      enquiry_product_interest: installation.enquiry_product_interest,
      // No issue_note here — a Yearly Service visit is a routine check-up
      // copied from its parent installation, never a reported problem.
      product_interest: installation.product_interest,
      product_code: installation.product_code,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);
  syncServiceToSheetSafely(data.id).catch(() => {});
  return data;
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
  syncServiceToSheetSafely(ticketId).catch(() => {});
  return data;
}
