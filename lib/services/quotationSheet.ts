import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { upsertRowByHeader } from './googleSheets';
import { logNotification } from './notifications';
import { formatINR } from '../format';

// Same spreadsheet as Sales/Service/Enquiry/Product List, its own tab.
export const QUOTATION_TAB = process.env.GOOGLE_QUOTATION_SHEET_TAB || 'Quotation';

/**
 * Mirrors a quotation into the spreadsheet's Quotation tab — same
 * one-way, "DB is the source of truth, this is a read-only ledger for
 * the business's own records" pattern as every other sheet in this app.
 * One row per quotation, not per item (a money/status ledger, not an
 * inventory one) — matched on quote_no, which never changes for a given
 * quotation's whole lifetime, so a status change (open/won/lost) or an
 * edit updates the same row in place.
 */
export async function syncQuotationToSheet(quotationId: string): Promise<void> {
  const { data: quotation, error } = await supabaseAdmin
    .from('quotations')
    .select('*, quotation_items(particulars), users:created_by(name)')
    .eq('id', quotationId)
    .single();
  if (error || !quotation) throw new ApiError(500, error?.message ?? `Quotation ${quotationId} not found for sheet export`);

  const items = (quotation.quotation_items as { particulars: string }[]) ?? [];
  const creator = quotation.users as unknown as { name: string } | null;

  const valuesByColumn: Record<string, string> = {
    quote_no: String(quotation.quote_no),
    date: quotation.quote_date,
    customer: quotation.customer_name ?? '',
    phone_number: quotation.phone_number ?? '',
    area: quotation.area ?? '',
    items: items.map((i) => i.particulars).join('; '),
    total: formatINR(Number(quotation.subtotal)),
    discount: formatINR(Number(quotation.discount)),
    grand_total: formatINR(Number(quotation.total)),
    status: quotation.status,
    created_by: creator?.name ?? '',
  };

  await upsertRowByHeader(QUOTATION_TAB, valuesByColumn, ['quote_no']);
}

/** Same fail-safe shape as every other sheet sync — never blocks the real operation. */
export async function syncQuotationToSheetSafely(quotationId: string): Promise<void> {
  try {
    await syncQuotationToSheet(quotationId);
  } catch (e) {
    await logNotification('quotation_sheet_failed', 'failed', (e as Error).message);
  }
}
