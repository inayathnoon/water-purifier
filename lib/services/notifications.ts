import { supabaseAdmin } from '../db';
import { sendTelegramMessage } from './telegram';
import { formatDisplayDateIST, formatDateRangeWithDaysIST } from '../dates';

export type EventType =
  | 'job_assigned'
  | 'job_completed'
  | 'leave_requested'
  | 'leave_decided'
  | 'product_sync_failed'
  | 'sales_sheet_failed'
  | 'service_sheet_failed'
  | 'enquiry_sheet_failed'
  | 'customer_phone_rekey_failed'
  | 'spare_part_sale_sheet_failed'
  | 'payments_sheet_failed'
  | 'quotation_sheet_failed';

/**
 * Records something that needs a human's attention even though nobody was
 * watching when it happened — a failed nightly sync, a delivery failure.
 * §9.6/§10.5: failures must be visible afterwards, not swallowed.
 */
export async function logNotification(
  eventType: EventType,
  status: 'sent' | 'failed' | 'pending',
  errorMessage?: string
) {
  await supabaseAdmin.from('notifications_log').insert({
    event_type: eventType,
    status,
    error_message: errorMessage ?? null,
  });
}

function appUrl(path: string): string {
  const base = process.env.APP_URL || 'http://localhost:3000';
  return `${base}${path}`;
}

/**
 * Telegram's HTML parser (`parse_mode: 'HTML'`, set once in
 * sendTelegramMessage) rejects the *entire* message with a 400 if any
 * interpolated value contains `<`, `>`, or an `&` that looks like the
 * start of an entity — and the failure is silent to whoever needed the
 * message: sendAndLog() records `failed` in notifications_log, nobody
 * watches that table, and a technician simply never gets the job. Every
 * value that comes from a free-text field an admin actually typed
 * (customer name, address, a reported problem, an enquiry explanation, a
 * leave reason) goes through this before interpolation — the literal
 * `<b>`/`</b>` tags this file writes itself are never passed through it.
 */
export function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * §10.5: the shared shape every notify* function below follows — send,
 * then log the outcome either way. Never throws; a Telegram failure is
 * recorded, not propagated, so it can never fail the job that triggered it.
 * Callers must call this *after* their own DB write has already committed.
 */
async function sendAndLog(eventType: EventType, text: string) {
  const result = await sendTelegramMessage(text);
  await logNotification(eventType, result.ok ? 'sent' : 'failed', result.error);
}

const LOCATION_PHRASE: Record<'home' | 'office', string> = { home: 'home visit', office: 'office' };

/** §10.3 row 1: this is the entire work order now — a technician has no
 * login (the staff self-service portal is gone), so every fact they need
 * lives in the message body itself, not behind the trailing link (kept
 * here for the admins/owner also in the group, who *can* use it).
 * Reordered so the technician's name and the when come first — that's
 * what each person in the group is actually scanning for. */
export async function notifyJobAssigned(input: {
  ticketId: string;
  productOrKind: string;
  bookedDate: string;
  bookedHalfDay: string;
  location: 'home' | 'office';
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerArea: string;
  technicianName: string;
  // Who actually clicked "book" — every other row in this app already
  // has an actor; this was the one silent one.
  assignedByName?: string | null;
  // Only ever set on an ad-hoc Service Call — a technician has no other
  // way to see this now that there's no staff login (this was previously
  // shown only on /staff/jobs's "Reported problem" box).
  issueNote?: string | null;
}) {
  const text =
    `📋 <b>Job assigned</b> — ${esc(input.technicianName)}` +
    (input.assignedByName ? ` · by ${esc(input.assignedByName)}` : '') +
    `\n${formatDisplayDateIST(input.bookedDate)}, ${input.bookedHalfDay} · ${LOCATION_PHRASE[input.location]}\n` +
    `${esc(input.productOrKind)}\n` +
    `${esc(input.customerName)} · ${esc(input.customerPhone)}\n` +
    `${esc(input.customerAddress)}, ${esc(input.customerArea)}` +
    (input.issueNote ? `\n⚠️ Reported problem: ${esc(input.issueNote)}` : '') +
    `\n${appUrl(`/tickets/${input.ticketId}`)}`;

  await sendAndLog('job_assigned', text);
}

/** §10.3 row 2: who finished what, for whom, where, and when. No prices
 * (§10.6). No duration line — the "actual" start/end times behind it
 * were never real (fixed half-day windows since the staff-portal
 * removal, not anything a technician actually clocked), so "Took 3h 0m"
 * was always the exact same fabricated number for every job in that
 * slot. Neither shown here nor stored on the ticket any more (see
 * completeJob()). Link kept for admin/owner, same as notifyJobAssigned(). */
export async function notifyJobCompleted(input: {
  ticketId: string;
  technicianName: string;
  productOrKind: string;
  customerName: string;
  customerAddress: string;
  completedDate: string;
}) {
  const text =
    `✅ <b>Job completed</b> — ${formatDisplayDateIST(input.completedDate)}\n` +
    `${esc(input.technicianName)} finished ${esc(input.productOrKind)} for ${esc(input.customerName)}\n` +
    `${esc(input.customerAddress)}\n` +
    `${appUrl(`/tickets/${input.ticketId}`)}`;

  await sendAndLog('job_completed', text);
}

/** §10.3 row 3: who, which dates, why, and a link for an owner to decide.
 * The reason is the actual basis for the decision — omitting it meant
 * the owner had to open the app for a one-line answer, defeating the
 * point of posting this to the group at all. */
export async function notifyLeaveRequested(input: { requesterName: string; startDate: string; endDate: string; reason: string }) {
  // §11.3: only an owner can decide this — the message previously read
  // like a plain FYI to the whole group, with nothing marking it as
  // something specifically waiting on the owner to act.
  const text =
    `🌴 <b>Leave requested — needs owner's decision</b>\n` +
    `${esc(input.requesterName)} · ${formatDateRangeWithDaysIST(input.startDate, input.endDate)}\n` +
    `Reason: ${esc(input.reason)}\n` +
    `${appUrl('/owner/leave')}`;

  await sendAndLog('leave_requested', text);
}

/** §11.3/§11.4: the owner's decision, sent back to the same group the
 * request itself was posted to — the requester's only reliable channel,
 * since there's no per-person Telegram DM in this setup. Approved and
 * denied get visually distinct marks (both used to open with the same
 * 🌴, reading identically when scanning the group's history) and both
 * name the deciding owner — the other silent actor besides the assigning
 * admin. `reason` is only ever non-null on a denial (requestLeave()'s own
 * DB trigger guarantees that), but the signature accepts null for any
 * future caller, so it's labeled and guarded rather than trusted. */
export async function notifyLeaveDecided(input: {
  requesterName: string;
  decision: 'approved' | 'denied';
  startDate: string;
  endDate: string;
  decidedByName: string;
  reason?: string | null;
}) {
  const range = formatDateRangeWithDaysIST(input.startDate, input.endDate);
  const text =
    input.decision === 'approved'
      ? `✅ <b>Leave approved</b> — ${esc(input.requesterName)}\n${range} · approved by ${esc(input.decidedByName)}\n${appUrl('/owner/leave')}`
      : `🚫 <b>Leave denied</b> — ${esc(input.requesterName)}\n${range} · decided by ${esc(input.decidedByName)}` +
        (input.reason ? `\nReason: ${esc(input.reason)}` : '') +
        `\n${appUrl('/owner/leave')}`;

  await sendAndLog('leave_decided', text);
}
