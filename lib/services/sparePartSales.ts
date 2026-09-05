import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

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
