import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { syncSparePartSaleToSheetSafely } from './sparePartSalesSheet';

export interface SparePartSaleItem {
  partName: string;
  unitPrice: number;
  quantity: number;
}

/**
 * A spare part sold on its own — no technician visit, no job, often no
 * known customer (a walk-in at the office). Deliberately not a
 * service_visit ticket: there's no work being done, nothing to book or
 * assign, and forcing it through that model would misrepresent it as a
 * job in every other screen that reads tickets.
 */
export async function recordSparePartSale(input: {
  items: SparePartSaleItem[];
  customerName?: string;
  phoneNumber?: string;
  soldBy: string;
}) {
  if (input.items.length === 0) throw new ApiError(400, 'At least one part is required');

  const rows = input.items.map((it) => ({
    part_name: it.partName,
    unit_price: it.unitPrice,
    quantity: it.quantity,
    total: it.unitPrice * it.quantity,
    customer_name: input.customerName?.trim() || null,
    phone_number: input.phoneNumber?.trim() || null,
    sold_by: input.soldBy,
  }));

  const { data, error } = await supabaseAdmin.from('spare_part_sales').insert(rows).select('*');
  if (error) throw new ApiError(500, error.message);

  // Registered the moment the sale is made, same reasoning as every
  // other sheet sync in this app — one row per item, since a single
  // sale can cover several parts at once.
  await Promise.all(data.map((row) => syncSparePartSaleToSheetSafely(row.id)));

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

/**
 * Correcting a mistyped office sale — wrong part, wrong quantity, wrong
 * customer detail. No state gate (unlike a purchase's edit window):
 * this is a plain retail record with no payment, no warranty, no order
 * on it, so there's no hard-rule invariant an edit here could corrupt.
 * Re-syncs the same sheet row in place afterward (matched on this
 * sale's own id, same as when it was first written).
 */
export async function updateSparePartSale(
  saleId: string,
  updates: { partName?: string; unitPrice?: number; quantity?: number; customerName?: string; phoneNumber?: string }
) {
  const { data: existing, error: findError } = await supabaseAdmin.from('spare_part_sales').select('*').eq('id', saleId).single();
  if (findError || !existing) throw new ApiError(404, 'Spare part sale not found');

  const partName = updates.partName ?? existing.part_name;
  const unitPrice = updates.unitPrice ?? Number(existing.unit_price);
  const quantity = updates.quantity ?? existing.quantity;
  if (!partName.trim()) throw new ApiError(400, 'Part name is required');
  if (unitPrice < 0) throw new ApiError(400, 'Unit price must be zero or more');
  if (quantity <= 0) throw new ApiError(400, 'Quantity must be at least 1');

  const patch = {
    part_name: partName,
    unit_price: unitPrice,
    quantity,
    total: unitPrice * quantity,
    customer_name: updates.customerName !== undefined ? updates.customerName.trim() || null : existing.customer_name,
    phone_number: updates.phoneNumber !== undefined ? updates.phoneNumber.trim() || null : existing.phone_number,
  };

  const { data, error } = await supabaseAdmin.from('spare_part_sales').update(patch).eq('id', saleId).select('*, users:sold_by(name)').single();
  if (error) throw new ApiError(500, error.message);

  await syncSparePartSaleToSheetSafely(saleId);
  return data;
}
