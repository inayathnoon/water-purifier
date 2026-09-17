import { supabaseAdmin } from '../db';
import { sendTelegramMessage } from './telegram';

type EventType =
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
  | 'payments_sheet_failed';

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
 * §10.5: the shared shape every notify* function below follows — send,
 * then log the outcome either way. Never throws; a Telegram failure is
 * recorded, not propagated, so it can never fail the job that triggered it.
 * Callers must call this *after* their own DB write has already committed.
 */
async function sendAndLog(eventType: EventType, text: string) {
  const result = await sendTelegramMessage(text);
  await logNotification(eventType, result.ok ? 'sent' : 'failed', result.error);
}

/** §10.3 row 1: product, date/half-day, home/office, customer name+address+
 * phone+area, technician. No link — a technician has no login (the
 * staff self-service portal is gone), so a `/tickets/[id]` link here was
 * a dead end that just bounced them to the sign-in page. The message
 * itself is the only thing a technician ever sees, so it carries the
 * phone number (to call before heading out, or if the address is hard
 * to find) and area directly instead of pointing anywhere. */
export async function notifyJobAssigned(input: {
  productOrKind: string;
  bookedDate: string;
  bookedHalfDay: string;
  location: 'home' | 'office';
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerArea: string;
  technicianName: string;
  // Only ever set on an ad-hoc Service Call — a technician has no other
  // way to see this now that there's no staff login (this was previously
  // shown only on /staff/jobs's "Reported problem" box).
  issueNote?: string | null;
}) {
  const text =
    `📋 <b>Job assigned</b>\n` +
    `${input.productOrKind} — ${input.bookedDate} (${input.bookedHalfDay}), ${input.location}\n` +
    `${input.customerName}, ${input.customerPhone}\n` +
    `${input.customerAddress}, ${input.customerArea}\n` +
    `Assigned to: ${input.technicianName}` +
    (input.issueNote ? `\n⚠️ Reported problem: ${input.issueNote}` : '');

  await sendAndLog('job_assigned', text);
}

/** §10.3 row 2: who finished what, for whom, where. No prices (§10.6).
 * No duration line — the "actual" start/end times behind it were never
 * real (fixed half-day windows since the staff-portal removal, not
 * anything a technician actually clocked), so "Took 3h 0m" was always
 * the exact same fabricated number for every job in that slot. Neither
 * shown here nor stored on the ticket any more (see completeJob()). No
 * link either, same reasoning as notifyJobAssigned(). */
export async function notifyJobCompleted(input: {
  technicianName: string;
  productOrKind: string;
  customerName: string;
  customerAddress: string;
}) {
  const text =
    `✅ <b>Job completed</b>\n` +
    `${input.technicianName} finished ${input.productOrKind} for ${input.customerName}, ${input.customerAddress}`;

  await sendAndLog('job_completed', text);
}

/** §10.3 row 3: who, which dates, and a link for an owner to decide. */
export async function notifyLeaveRequested(input: { requesterName: string; startDate: string; endDate: string }) {
  // §11.3: only an owner can decide this — the message previously read
  // like a plain FYI to the whole group, with nothing marking it as
  // something specifically waiting on the owner to act.
  const text =
    `🌴 <b>Leave requested — needs owner's decision</b>\n` +
    `${input.requesterName}: ${input.startDate} to ${input.endDate}\n` +
    `${appUrl('/owner/leave')}`;

  await sendAndLog('leave_requested', text);
}

/** §11.3/§11.4: the owner's decision, sent back to the same group the
 * request itself was posted to — the requester's only reliable channel,
 * since there's no per-person Telegram DM in this setup. */
export async function notifyLeaveDecided(input: {
  requesterName: string;
  decision: 'approved' | 'denied';
  startDate: string;
  endDate: string;
  reason?: string | null;
}) {
  const text =
    input.decision === 'approved'
      ? `🌴 <b>Leave approved</b>\n${input.requesterName}: ${input.startDate} to ${input.endDate}`
      : `🌴 <b>Leave denied</b>\n${input.requesterName}: ${input.startDate} to ${input.endDate}\n${input.reason}`;

  await sendAndLog('leave_decided', text);
}

