import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { syncOrderToSalesSheetSafely } from './salesSheet';

async function getOrderOrThrow(orderId: string) {
  const { data, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).single();
  if (error || !data) throw new ApiError(404, 'Order not found');
  return data;
}

/**
 * §7.2: record a payment against an order. balance_owed recomputes
 * itself (generated column). If this payment brings the balance to
 * exactly 0, the order is closed in the same call — "closed" has never
 * been a separate business event in this app, just orders.status
 * flipping once nothing's owed (see closeOrder()), so there's no reason
 * to make the admin come back and click a second button for the common
 * case of a payment that finishes the sale off.
 */
export async function recordPayment(
  orderId: string,
  amount: number,
  recordedBy?: string,
  paymentDate?: string
) {
  if (amount <= 0) throw new ApiError(400, 'Payment amount must be positive');
  if (paymentDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (paymentDate > today) throw new ApiError(400, 'Payment date cannot be in the future');
  }

  const order = await getOrderOrThrow(orderId);
  const newPaid = Number(order.paid_amount) + amount;
  if (newPaid > Number(order.sold_price)) {
    throw new ApiError(400, 'Payment would exceed the sold price');
  }

  // Noon UTC, not midnight, when a specific date is given — same
  // timezone-shift fix as Bill Date/Enquiry Date: a plain midnight value
  // lands on the wrong day depending on the server's own timezone.
  const paymentInstant = paymentDate ? `${paymentDate}T12:00:00Z` : new Date().toISOString();

  // A dated entry per payment, not just the running total — lets the
  // admin see payments against date later, not just "how much is paid
  // so far right now". Kept as a column on orders itself (not a separate
  // table) so there's nowhere else "how much was paid" can drift from
  // orders.paid_amount. recordedBy (added 2026-09-06) is who actually
  // clicked it — admin and owner both can, and until now nothing said
  // which one did for any given entry.
  const paymentHistory = [...(order.payment_history ?? []), { amount, date: paymentInstant, recordedBy: recordedBy ?? null }];

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ paid_amount: newPaid, payment_history: paymentHistory })
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);

  // Keep the Sales sheet's paid/balance in sync the moment a payment is
  // recorded, not just when the order eventually closes.
  await syncOrderToSalesSheetSafely(orderId);

  if (newPaid >= Number(order.sold_price)) {
    return closeOrder(orderId);
  }

  return data;
}

/**
 * §7.3: while anything is owed, the admin must call every 3 days. This just
 * timestamps the call — the "who's overdue for a call" list is a read-time
 * query (see lib/services/dashboard.ts, Stage 7), not a background job.
 */
export async function logPaymentCall(orderId: string, note: string, ticketIdForCallLog: string, createdBy: string) {
  if (!note.trim()) throw new ApiError(400, 'A call note is required');

  await supabaseAdmin.from('call_log').insert({ ticket_id: ticketIdForCallLog, note, created_by: createdBy });

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ last_payment_call_at: new Date().toISOString() })
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  return data;
}

/**
 * §7.5/§13.1: the single most important rule. The DB trigger enforces this
 * too (belt and suspenders) — this function exists so the API can return a
 * clean error message instead of a raw Postgres exception.
 */
export async function closeOrder(orderId: string) {
  const order = await getOrderOrThrow(orderId);
  const balanceOwed = Number(order.sold_price) - Number(order.paid_amount);

  if (balanceOwed > 0) {
    throw new ApiError(400, `Cannot close order — ${balanceOwed.toFixed(2)} still owed`);
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'closed' })
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);

  // Redundant with the sync already done in recordPayment() (balance is
  // already 0 by now) — kept as a final safety net, since "closed" is
  // just orders.status flipping, not a separate business event.
  await syncOrderToSalesSheetSafely(orderId);

  return data;
}

/**
 * A separate follow-up satisfaction call, made sometime after the
 * installation itself is done — distinct from the confirm-and-close call
 * that stamps installation_date (that one is "was the job done right?",
 * this one is "checking in a few weeks later"). Requires a short note
 * (3+ words) rather than a bare click, same shape as §5.4/§5.5's
 * word-count rule for enquiry closure — a note that's actually a note,
 * not just a formality.
 */
export async function confirmOrderSatisfaction(orderId: string, note: string) {
  const wordCount = note.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 3) {
    throw new ApiError(400, 'Please write at least 3 words about the call');
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({
      confirmation_status: 'completed',
      confirmation_note: note.trim(),
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  return data;
}
