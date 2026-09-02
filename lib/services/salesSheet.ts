import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { appendRowByHeader } from './googleSheets';

// Same spreadsheet as products, a different tab. Overridable in case the
// business ever renames this tab too, same reasoning as
// GOOGLE_SHEETS_RANGE for the product tab.
const SALES_TAB = process.env.GOOGLE_SALES_SHEET_TAB || 'Sales';

/**
 * Mirrors a just-closed order into the Sales sheet, filling in every
 * column the business shouldn't have to type by hand — category, brand,
 * product_name, variant, and list_price from the linked product;
 * discount and balance_owed from the order; warranty_expires_at from the
 * ticket. The DB stays the source of truth for sales (unlike products,
 * which genuinely live in the sheet) — this is a one-way log, so the
 * business keeps the same running ledger they had before this app
 * existed, without re-typing a thing.
 *
 * Called right after an order closes, not when it's created — that's the
 * one point every field is actually settled: paid_amount == sold_price
 * (an order can't close otherwise, §13.1), and installation_date /
 * warranty_expires_at are already stamped (§8.1).
 */
export async function appendClosedOrderToSalesSheet(orderId: string): Promise<void> {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select(
      '*, tickets(planned_installation_date, installation_date, warranty_expires_at, enquiry_product_interest, product_code, customers(name, phone_number, address, area), products(category, brand, name, variant, list_price))'
    )
    .eq('id', orderId)
    .single();
  if (error || !order) throw new ApiError(500, error?.message ?? `Order ${orderId} not found for sales sheet export`);

  const ticket = order.tickets as unknown as {
    planned_installation_date: string | null;
    installation_date: string | null;
    warranty_expires_at: string | null;
    enquiry_product_interest: string | null;
    product_code: string | null;
    customers: { name: string; phone_number: string; address: string; area: string };
    products: { category: string; brand: string; name: string; variant: string | null; list_price: number | null } | null;
  };
  const customer = ticket.customers;
  const product = ticket.products;

  const valuesByColumn: Record<string, string> = {
    bill_date: order.created_at.slice(0, 10),
    planned_installation_date: ticket.planned_installation_date ?? '',
    installation_date: ticket.installation_date ?? '',
    name: customer.name,
    place: customer.area,
    phone_number: customer.phone_number,
    sku: ticket.product_code ?? '',
    category: product?.category ?? '',
    brand: product?.brand ?? '',
    // Free-text/historical purchases with no linked product still get a
    // human-readable name in the sheet, same fallback as the Orders page.
    product_name: product?.name ?? ticket.enquiry_product_interest ?? '',
    variant: product?.variant ?? '',
    list_price: String(order.list_price),
    sold_price: String(order.sold_price),
    discount: String(order.discount),
    paid_amount: String(order.paid_amount),
    balance_owed: String(order.balance_owed),
    address: customer.address,
    warranty_expires_at: ticket.warranty_expires_at ?? '',
  };

  await appendRowByHeader(SALES_TAB, valuesByColumn);
}
