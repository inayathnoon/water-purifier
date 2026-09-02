import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { upsertRowByHeader } from './googleSheets';
import { logNotification } from './notifications';

// Same spreadsheet as Sales/Product List, a different tab.
const SERVICE_TAB = process.env.GOOGLE_SERVICE_SHEET_TAB || 'Service';

/**
 * Mirrors a service_visit ticket into the spreadsheet's Service tab —
 * same "DB first, then the app pushes to the sheet" rule as Sales.
 * Matched on phone_number + date (stable for a given request's whole
 * lifetime), so it's created once when requested and updated in place
 * as it moves through booking/completion rather than duplicating rows.
 */
export async function syncServiceToSheet(ticketId: string): Promise<void> {
  const { data: ticket, error } = await supabaseAdmin
    .from('tickets')
    .select('created_at, status, service_declined, actual_date, actual_notes, enquiry_product_interest, customers(name, phone_number, address, area)')
    .eq('id', ticketId)
    .single();
  if (error || !ticket) throw new ApiError(500, error?.message ?? `Service ticket ${ticketId} not found for sheet export`);

  const customer = ticket.customers as unknown as { name: string; phone_number: string; address: string; area: string };

  // enquiry_product_interest holds "<product> — <issue note>" for a
  // freshly-requested service (see createAdHocServiceRequest) — split
  // it back apart for the sheet's separate product/notes columns.
  const [productPart, ...noteParts] = (ticket.enquiry_product_interest ?? '').split(' — ');
  const noteFromRequest = noteParts.join(' — ');

  const stage = ticket.status === 'closed' ? (ticket.service_declined ? 'Declined' : 'Service Completed') : '';

  const valuesByColumn: Record<string, string> = {
    date: ticket.created_at.slice(0, 10),
    phone_number: customer.phone_number,
    name: customer.name,
    address: customer.address,
    area: customer.area,
    product: productPart ?? '',
    stage,
    via: '',
    closed_date: ticket.status === 'closed' ? (ticket.actual_date ?? ticket.created_at.slice(0, 10)) : '',
    notes: ticket.actual_notes || noteFromRequest || '',
  };

  await upsertRowByHeader(SERVICE_TAB, valuesByColumn, ['phone_number', 'date']);
}

/** Same fail-safe shape as every other sheet sync — never blocks the real operation. */
export async function syncServiceToSheetSafely(ticketId: string): Promise<void> {
  try {
    await syncServiceToSheet(ticketId);
  } catch (e) {
    await logNotification('service_sheet_failed', 'failed', (e as Error).message);
  }
}
