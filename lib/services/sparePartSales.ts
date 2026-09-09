import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { syncSparePartSaleToSheetSafely } from './sparePartSalesSheet';
import { logSparePartSalePaymentToSheetSafely, logTicketPaymentToSheetSafely } from './paymentsSheet';
import { todayIST, isWithinWarranty } from '../dates';

export interface SparePartSaleItem {
  partName: string;
  unitPrice: number;
  quantity: number;
}

/**
 * A spare part sold on its own — no technician visit, no job, often no
 * known customer (a walk-in at the office) — or a spare part sold as part
 * of confirming an installation/service visit (`ticketId` given, from the
 * admin dashboard's "Finished Installation/Service" card). Deliberately
 * still not a second `service_visit` ticket for the office case: there's
 * no work being done there, nothing to book or assign.
 */
export async function recordSparePartSale(input: {
  items: SparePartSaleItem[];
  customerName?: string;
  phoneNumber?: string;
  soldBy: string;
  ticketId?: string;
}) {
  if (input.items.length === 0) throw new ApiError(400, 'At least one part is required');

  let items = input.items;
  if (input.ticketId) {
    const { data: ticket, error } = await supabaseAdmin
      .from('tickets')
      .select('kind, installation_date')
      .eq('id', input.ticketId)
      .single();
    if (error || !ticket) throw new ApiError(404, 'Linked ticket not found');

    // §13.3: no charge inside the warranty year — this flow has no other
    // warranty check anywhere else, so it has to be enforced right here,
    // server-side, regardless of what price the form sent. Forced to 0,
    // not refused, so the admin can still record *that* a part was used
    // (matches the old tech-facing picker's "under warranty, no charge").
    if (ticket.kind === 'service_visit' && isWithinWarranty(ticket.installation_date, todayIST())) {
      items = items.map((it) => ({ ...it, unitPrice: 0 }));
    }
  }

  const rows = items.map((it) => ({
    part_name: it.partName,
    unit_price: it.unitPrice,
    quantity: it.quantity,
    total: it.unitPrice * it.quantity,
    customer_name: input.customerName?.trim() || null,
    phone_number: input.phoneNumber?.trim() || null,
    sold_by: input.soldBy,
    ticket_id: input.ticketId ?? null,
  }));

  const { data, error } = await supabaseAdmin.from('spare_part_sales').insert(rows).select('*');
  if (error) throw new ApiError(500, error.message);

  // Registered the moment the sale is made, same reasoning as every
  // other sheet sync in this app — one row per item, since a single
  // sale can cover several parts at once. Fire-and-forget (not awaited)
  // — each of these is a Sheets round trip, and the DB insert above has
  // already committed.
  Promise.all(data.map((row) => syncSparePartSaleToSheetSafely(row.id))).catch(() => {});

  // Payments ledger — one row for the whole sale's total, not per item
  // (this is a money log, not an inventory one). A job-linked sale logs
  // against that ticket (same 'Service' channel a chargeable visit
  // always used); an office walk-in has no ticket to log against.
  const total = data.reduce((sum, row) => sum + Number(row.total), 0);
  if (input.ticketId) {
    logTicketPaymentToSheetSafely({
      ticketId: input.ticketId,
      channel: 'Service',
      amount: total,
      date: new Date().toISOString(),
    }).catch(() => {});
  } else {
    logSparePartSalePaymentToSheetSafely({
      phoneNumber: input.phoneNumber?.trim() || null,
      name: input.customerName?.trim() || null,
      amount: total,
      date: new Date().toISOString(),
    }).catch(() => {});
  }

  return data;
}

export async function listRecentSparePartSales(limit = 20) {
  const { data, error } = await supabaseAdmin
    .from('spare_part_sales')
    .select('*, users:sold_by(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new ApiError(500, error.message);
  return data;
}

/** Every spare part sold against one particular job — used to show what's already been recorded on it. */
export async function listSparePartSalesForTicket(ticketId: string) {
  const { data, error } = await supabaseAdmin
    .from('spare_part_sales')
    .select('*, users:sold_by(name)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return data;
}

/**
 * Correcting a mistyped sale — wrong part, wrong quantity, wrong customer
 * detail. No state gate (unlike a purchase's edit window): this is a
 * plain retail record with no payment beyond its own total, so there's no
 * hard-rule invariant an edit here could corrupt on its own — except a
 * job-linked sale's price, which still has to respect §13.3 exactly like
 * it did when the sale was first recorded. Re-syncs the same sheet row in
 * place afterward (matched on this sale's own id, same as when it was
 * first written).
 */
export async function updateSparePartSale(
  saleId: string,
  updates: { partName?: string; unitPrice?: number; quantity?: number; customerName?: string; phoneNumber?: string; saleDate?: string }
) {
  const { data: existing, error: findError } = await supabaseAdmin.from('spare_part_sales').select('*').eq('id', saleId).single();
  if (findError || !existing) throw new ApiError(404, 'Spare part sale not found');

  const partName = updates.partName ?? existing.part_name;
  let unitPrice = updates.unitPrice ?? Number(existing.unit_price);
  const quantity = updates.quantity ?? existing.quantity;
  if (!partName.trim()) throw new ApiError(400, 'Part name is required');
  if (unitPrice < 0) throw new ApiError(400, 'Unit price must be zero or more');
  if (quantity <= 0) throw new ApiError(400, 'Quantity must be at least 1');
  if (updates.saleDate && updates.saleDate > todayIST()) throw new ApiError(400, 'Sale date cannot be in the future');

  if (existing.ticket_id) {
    const { data: ticket } = await supabaseAdmin.from('tickets').select('kind, installation_date').eq('id', existing.ticket_id).single();
    if (ticket?.kind === 'service_visit' && isWithinWarranty(ticket.installation_date, todayIST())) {
      unitPrice = 0;
    }
  }

  const patch: Record<string, unknown> = {
    part_name: partName,
    unit_price: unitPrice,
    quantity,
    total: unitPrice * quantity,
    customer_name: updates.customerName !== undefined ? updates.customerName.trim() || null : existing.customer_name,
    phone_number: updates.phoneNumber !== undefined ? updates.phoneNumber.trim() || null : existing.phone_number,
  };
  // No sheet-rekey needed here (unlike Sales/Enquiry/Service) — this
  // sheet is matched on the sale's own id, not date, so changing the
  // date can never make an existing row un-findable.
  if (updates.saleDate) patch.created_at = `${updates.saleDate}T12:00:00Z`;

  const { data, error } = await supabaseAdmin.from('spare_part_sales').update(patch).eq('id', saleId).select('*, users:sold_by(name)').single();
  if (error) throw new ApiError(500, error.message);

  syncSparePartSaleToSheetSafely(saleId).catch(() => {});
  return data;
}
