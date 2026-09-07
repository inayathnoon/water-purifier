import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../db';
import { upsertRowByHeader } from './googleSheets';
import { logNotification } from './notifications';

// Same spreadsheet as Sales/Service/Enquiry/Spare Part Sales, a new tab —
// a pure money ledger, one row per payment event, across every channel
// real money moves through this app. Deliberately append-only: matched
// on a freshly generated id every time (same trick Spare Part Sales
// already uses), so it can never "update" an existing row — a past
// entry is never edited, only new ones are ever added (2026-09-07).
export const PAYMENTS_TAB = process.env.GOOGLE_PAYMENTS_SHEET_TAB || 'Payments';

export type PaymentChannel = 'Purchase' | 'Balance Collected' | 'Service' | 'Spare-office';

async function appendPaymentRow(row: {
  date: string;
  phoneNumber: string | null;
  name: string | null;
  channel: PaymentChannel;
  amount: number;
  reference: string;
}): Promise<void> {
  await upsertRowByHeader(
    PAYMENTS_TAB,
    {
      id: randomUUID(),
      date: row.date.slice(0, 10),
      phone_number: row.phoneNumber ?? '',
      name: row.name ?? '',
      channel: row.channel,
      amount: String(row.amount),
      reference: row.reference,
    },
    ['id']
  );
}

/**
 * Logs a payment tied to a ticket (a purchase's initial paid amount, a
 * later payment collected against its balance, or an out-of-warranty
 * service visit's charge) — looks up the customer and a product/issue
 * reference itself so every call site doesn't have to carry that data
 * around just for this.
 */
export async function logTicketPaymentToSheet(input: {
  ticketId: string;
  channel: 'Purchase' | 'Balance Collected' | 'Service';
  amount: number;
  date: string;
}): Promise<void> {
  if (input.amount <= 0) return; // nothing actually changed hands
  const { data: ticket, error } = await supabaseAdmin
    .from('tickets')
    .select('product_interest, enquiry_product_interest, customers(name, phone_number)')
    .eq('id', input.ticketId)
    .single();
  if (error || !ticket) throw new Error(`Ticket ${input.ticketId} not found for payments sheet export`);
  const customer = ticket.customers as unknown as { name: string; phone_number: string } | null;

  await appendPaymentRow({
    date: input.date,
    phoneNumber: customer?.phone_number ?? null,
    name: customer?.name ?? null,
    channel: input.channel,
    amount: input.amount,
    reference: ticket.product_interest ?? ticket.enquiry_product_interest ?? '',
  });
}

/** Same fail-safe shape as every other sheet sync — never blocks the real operation. */
export async function logTicketPaymentToSheetSafely(input: {
  ticketId: string;
  channel: 'Purchase' | 'Balance Collected' | 'Service';
  amount: number;
  date: string;
}): Promise<void> {
  try {
    await logTicketPaymentToSheet(input);
  } catch (e) {
    await logNotification('payments_sheet_failed', 'failed', (e as Error).message);
  }
}

/** An office spare-part sale has no ticket at all — customer details (if any) are passed straight through. */
export async function logSparePartSalePaymentToSheet(input: {
  phoneNumber: string | null;
  name: string | null;
  amount: number;
  date: string;
}): Promise<void> {
  if (input.amount <= 0) return;
  await appendPaymentRow({
    date: input.date,
    phoneNumber: input.phoneNumber,
    name: input.name,
    channel: 'Spare-office',
    amount: input.amount,
    reference: 'Spare parts',
  });
}

export async function logSparePartSalePaymentToSheetSafely(input: {
  phoneNumber: string | null;
  name: string | null;
  amount: number;
  date: string;
}): Promise<void> {
  try {
    await logSparePartSalePaymentToSheet(input);
  } catch (e) {
    await logNotification('payments_sheet_failed', 'failed', (e as Error).message);
  }
}
