import { supabaseAdmin } from '../db';
import { sendTelegramMessage } from './telegram';

type EventType =
  | 'job_assigned'
  | 'job_completed'
  | 'leave_requested'
  | 'payment_reminder'
  | 'product_sync_failed'
  | 'sales_sheet_failed'
  | 'service_sheet_failed'
  | 'enquiry_passed_to_owner'
  | 'enquiry_sheet_failed';

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

/** §10.3 row 1: product, date/half-day, home/office, customer name+address, technician, a link. */
export async function notifyJobAssigned(input: {
  ticketId: string;
  productOrKind: string;
  bookedDate: string;
  bookedHalfDay: string;
  location: 'home' | 'office';
  customerName: string;
  customerAddress: string;
  technicianName: string;
}) {
  const text =
    `📋 <b>Job assigned</b>\n` +
    `${input.productOrKind} — ${input.bookedDate} (${input.bookedHalfDay}), ${input.location}\n` +
    `${input.customerName}, ${input.customerAddress}\n` +
    `Assigned to: ${input.technicianName}\n` +
    `${appUrl(`/tickets/${input.ticketId}`)}`;

  await sendAndLog('job_assigned', text);
}

/** §10.3 row 2: who finished what, for whom, and how long it took. No prices (§10.6). */
export async function notifyJobCompleted(input: {
  ticketId: string;
  technicianName: string;
  productOrKind: string;
  customerName: string;
  startTime: string;
  endTime: string;
}) {
  const duration = formatDuration(input.startTime, input.endTime);
  const text =
    `✅ <b>Job completed</b>\n` +
    `${input.technicianName} finished ${input.productOrKind} for ${input.customerName}\n` +
    `Took ${duration}\n` +
    `${appUrl(`/tickets/${input.ticketId}`)}`;

  await sendAndLog('job_completed', text);
}

/** §10.3 row 3: who, which dates, and a link for an owner to decide. */
export async function notifyLeaveRequested(input: { requesterName: string; startDate: string; endDate: string }) {
  const text =
    `🌴 <b>Leave requested</b>\n` +
    `${input.requesterName}: ${input.startDate} to ${input.endDate}\n` +
    `${appUrl('/owner/leave')}`;

  await sendAndLog('leave_requested', text);
}

/** §2.1: an admin couldn't close this enquiry themselves and passed it up. */
export async function notifyEnquiryPassedToOwner(input: {
  ticketId: string;
  customerName: string;
  explanation: string;
}) {
  const text =
    `🔺 <b>Enquiry passed to you</b>\n` +
    `${input.customerName}\n` +
    `${input.explanation}\n` +
    `${appUrl(`/tickets/${input.ticketId}`)}`;

  await sendAndLog('enquiry_passed_to_owner', text);
}

function formatDuration(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return 'a short visit';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
