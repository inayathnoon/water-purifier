import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { upsertRowByHeader } from './googleSheets';
import { logNotification } from './notifications';

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
