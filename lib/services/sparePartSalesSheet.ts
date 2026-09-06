import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { upsertRowByHeader, clearRowsByPrefix } from './googleSheets';
import { logNotification } from './notifications';
import type { ChargeBreakdownItem } from './tickets';

// Same spreadsheet as Sales/Service/Enquiry/Products, its own tab.
export const SPARE_PART_SALES_TAB = process.env.GOOGLE_SPARE_PART_SALES_SHEET_TAB || 'Spare Part Sales';

/**
 * Mirrors an office spare-part sale into its own sheet tab — same
 * one-way, fire-after-the-DB-write-commits pattern as Sales/Service/
 * Enquiry (§9/§10.5). Found in a full operational review (2026-09-06)
 * to be the only revenue path in this app with no ledger row at all —
 * every other sale, service charge, and enquiry outcome already lands
 * in a sheet automatically; this was the one gap.
 *
 * Matched on the sale's own id rather than phone_number+date the way
 * Sales/Service/Enquiry are — a spare-part sale is a one-time event,
 * never edited or re-synced after creation (unlike those three, which
 * get updated in place across a real lifecycle), so id is both simpler
 * and exact; upserting on it just guards against an accidental
 * double-call rather than ever needing to actually update a row.
 */
export async function syncSparePartSaleToSheet(saleId: string): Promise<void> {
  const { data: sale, error } = await supabaseAdmin
    .from('spare_part_sales')
    .select('*, users:sold_by(name)')
    .eq('id', saleId)
    .single();
  if (error || !sale) throw new ApiError(500, error?.message ?? `Spare part sale ${saleId} not found for sheet export`);

  const seller = sale.users as unknown as { name: string } | null;

  const valuesByColumn: Record<string, string> = {
    id: sale.id,
    date: sale.created_at.slice(0, 10),
    part_name: sale.part_name,
    unit_price: String(sale.unit_price),
    quantity: String(sale.quantity),
    total: String(sale.total),
    customer_name: sale.customer_name ?? '',
    phone_number: sale.phone_number ?? '',
    sold_by: seller?.name ?? '',
    channel: 'Office',
  };

  await upsertRowByHeader(SPARE_PART_SALES_TAB, valuesByColumn, ['id']);
}

/** Same as syncSparePartSaleToSheet(), but never throws — see §10.5/§9.6. */
export async function syncSparePartSaleToSheetSafely(saleId: string): Promise<void> {
  try {
    await syncSparePartSaleToSheet(saleId);
  } catch (e) {
    await logNotification('spare_part_sale_sheet_failed', 'failed', (e as Error).message);
  }
}

/**
 * The other channel into the same ledger: spare parts a technician
 * actually fitted during a service visit (`tickets.charge_breakdown`),
 * one row per part — same columns as an office sale, `channel` the only
 * thing that tells them apart. The flat "Service charges" line isn't a
 * part leaving inventory, so it's excluded here exactly like the Spare
 * Parts picker itself excludes it from being "sold on its own".
 *
 * A service visit's whole breakdown gets rewritten on every completion
 * or §8.4 correction, so this clears every row this ticket has written
 * before adding the current set fresh — otherwise a correction that
 * drops a part would leave its old row behind, still claiming that part
 * was used. Rows are keyed `{ticketId}-{index}`, not a real id (a
 * breakdown item has none of its own) — stable enough to upsert against
 * for the common case (same items, a charge corrected) and harmless
 * either way since the whole set is cleared first regardless.
 */
export async function syncServiceVisitPartsToSheet(ticketId: string): Promise<void> {
  const { data: ticket, error } = await supabaseAdmin
    .from('tickets')
    .select('actual_date, charge_breakdown, customers(name, phone_number), users:assigned_to_id(name)')
    .eq('id', ticketId)
    .single();
  if (error || !ticket) throw new ApiError(500, error?.message ?? `Ticket ${ticketId} not found for spare-part sheet export`);

  const customer = ticket.customers as unknown as { name: string; phone_number: string };
  const technician = ticket.users as unknown as { name: string } | null;
  const items = ((ticket.charge_breakdown as ChargeBreakdownItem[] | null) ?? []).filter((i) => !i.isServiceCharge);

  await clearRowsByPrefix(SPARE_PART_SALES_TAB, 'id', `${ticketId}-`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await upsertRowByHeader(
      SPARE_PART_SALES_TAB,
      {
        id: `${ticketId}-${i}`,
        date: ticket.actual_date ?? '',
        part_name: item.name,
        unit_price: String(item.unitPrice),
        quantity: String(item.quantity),
        total: String(item.total),
        customer_name: customer?.name ?? '',
        phone_number: customer?.phone_number ?? '',
        sold_by: technician?.name ?? '',
        channel: 'Service Visit',
      },
      ['id']
    );
  }
}

/** Same as syncServiceVisitPartsToSheet(), but never throws — see §10.5/§9.6. */
export async function syncServiceVisitPartsToSheetSafely(ticketId: string): Promise<void> {
  try {
    await syncServiceVisitPartsToSheet(ticketId);
  } catch (e) {
    await logNotification('spare_part_sale_sheet_failed', 'failed', (e as Error).message);
  }
}
