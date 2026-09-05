import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { upsertRowByHeader } from './googleSheets';
import { logNotification } from './notifications';

// Same spreadsheet as Sales/Service/Product List, a different tab.
export const ENQUIRY_TAB = process.env.GOOGLE_ENQUIRY_SHEET_TAB || 'Enquiry';

const STAGE_LABEL: Record<string, string> = {
  open: 'ACTIVE',
  inactive: 'INACTIVE',
  passed_to_owner: 'PASSED TO OWNER',
  closed: 'CONVERTED', // the only way an enquiry reaches 'closed' is closeEnquiry(..., 'convert')
};

const VIA_LABEL: Record<string, string> = {
  general: 'GENERAL ENQUIRY',
  water_test: 'WATER TEST',
  ready_to_buy: 'READY TO BUY',
  referral: 'REFERRAL',
};

/**
 * Mirrors an enquiry ticket into the spreadsheet's Enquiry tab — same
 * "DB first, then the app pushes to the sheet" one-way pattern as
 * Sales/Service. Matched on phone_number + date (stable for a given
 * enquiry's whole lifetime), so it's created once and updated in place
 * as it moves through calls/closure rather than duplicating rows.
 */
export async function syncEnquiryToSheet(ticketId: string): Promise<void> {
  const { data: ticket, error } = await supabaseAdmin
    .from('tickets')
    .select('created_at, updated_at, status, enquiry_product_interest, enquiry_source, customers(name, phone_number, address, area)')
    .eq('id', ticketId)
    .single();
  if (error || !ticket) throw new ApiError(500, error?.message ?? `Enquiry ${ticketId} not found for sheet export`);

  const customer = ticket.customers as unknown as { name: string; phone_number: string; address: string; area: string };

  const valuesByColumn: Record<string, string> = {
    date: ticket.created_at.slice(0, 10),
    phone_number: customer.phone_number,
    name: customer.name,
    address: customer.address,
    area: customer.area,
    product: ticket.enquiry_product_interest ?? '',
    stage: STAGE_LABEL[ticket.status] ?? ticket.status.toUpperCase(),
    via: ticket.enquiry_source ? (VIA_LABEL[ticket.enquiry_source] ?? ticket.enquiry_source.toUpperCase()) : '',
    closed_date: ticket.status === 'open' ? '' : (ticket.updated_at ?? ticket.created_at).slice(0, 10),
  };

  await upsertRowByHeader(ENQUIRY_TAB, valuesByColumn, ['phone_number', 'date']);
}

/** Same fail-safe shape as every other sheet sync — never blocks the real operation. */
export async function syncEnquiryToSheetSafely(ticketId: string): Promise<void> {
  try {
    await syncEnquiryToSheet(ticketId);
  } catch (e) {
    await logNotification('enquiry_sheet_failed', 'failed', (e as Error).message);
  }
}
