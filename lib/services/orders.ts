import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

async function getOrderOrThrow(orderId: string) {
  const { data, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).single();
  if (error || !data) throw new ApiError(404, 'Order not found');
  return data;
}

/** §7.2: record a payment against an order. balance_owed recomputes itself (generated column). */
export async function recordPayment(orderId: string, amount: number) {
  if (amount <= 0) throw new ApiError(400, 'Payment amount must be positive');

  const order = await getOrderOrThrow(orderId);
  const newPaid = Number(order.paid_amount) + amount;
  if (newPaid > Number(order.sold_price)) {
    throw new ApiError(400, 'Payment would exceed the sold price');
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ paid_amount: newPaid })
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
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
  return data;
}
