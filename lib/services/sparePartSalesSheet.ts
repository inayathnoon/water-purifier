import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { upsertRowByHeader } from './googleSheets';
import { logNotification } from './notifications';

// Same spreadsheet as Sales/Service/Enquiry/Products, its own tab.
export const SPARE_PART_SALES_TAB = process.env.GOOGLE_SPARE_PART_SALES_SHEET_TAB || 'Spare Part Sales';

/**
 * Mirrors a spare-part sale into its own sheet tab — same one-way,
 * fire-after-the-DB-write-commits pattern as Sales/Service/Enquiry
 * (§9/§10.5). A sale is either a walk-in office sale (no `ticket_id`) or
 * one recorded against a specific job from the admin dashboard's
 * "Finished Installation/Service" card (`ticket_id` set) — `channel`
 * tells them apart (`Office` / `Installation` / `Service Visit`), and
 * `ticket_id` itself is also written as its own column so the sale is
 * traceable back to the exact job it came from.
 *
 * Matched on the sale's own id rather than phone_number+date the way
 * Sales/Service/Enquiry are — a spare-part sale is a one-time event,
 * never re-synced after creation except for a direct correction (see
 * updateSparePartSale()), so id is both simpler and exact.
 */
export async function syncSparePartSaleToSheet(saleId: string): Promise<void> {
  const { data: sale, error } = await supabaseAdmin
    .from('spare_part_sales')
    .select('*, users:sold_by(name), tickets:ticket_id(kind)')
    .eq('id', saleId)
    .single();
  if (error || !sale) throw new ApiError(500, error?.message ?? `Spare part sale ${saleId} not found for sheet export`);

  const seller = sale.users as unknown as { name: string } | null;
  const ticket = sale.tickets as unknown as { kind: string } | null;
  const channel = !ticket ? 'Office' : ticket.kind === 'installation' ? 'Installation' : 'Service Visit';

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
    channel,
    ticket_id: sale.ticket_id ?? '',
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
