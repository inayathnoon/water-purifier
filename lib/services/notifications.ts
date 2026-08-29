import { supabaseAdmin } from '../db';

type EventType = 'job_assigned' | 'job_completed' | 'leave_requested' | 'payment_reminder' | 'product_sync_failed';

/**
 * Records something that needs a human's attention even though nobody was
 * watching when it happened — a failed nightly sync, a delivery failure.
 * §9.6/§10.5: failures must be visible afterwards, not swallowed. Stage 6
 * wires this same table to actual Telegram delivery for the three
 * §10.3 message types; this function is the shared logging point both use.
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
