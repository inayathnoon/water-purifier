import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { upsertRowByHeader } from './googleSheets';
import { logNotification } from './notifications';

// Same spreadsheet as products, a different tab. Overridable in case the
// business ever renames this tab too, same reasoning as
// GOOGLE_SHEETS_RANGE for the product tab.
export const SALES_TAB = process.env.GOOGLE_SALES_SHEET_TAB || 'Sales';

/**
 * Keeps one Sales-sheet row per real sale in sync with the DB, from the
 * moment it's made through however long it takes to get paid off. The
 * sale is registered the instant it's created (not when it later
 * happens to close) — "closed" isn't a separate business event, it's
 * just what `orders.status` reads once balance_owed hits 0, so there's
 * nothing to wait for.
 *
 * Called after every DB write that changes something this sheet shows:
 * - createDirectPurchase(): the sale first exists (row is inserted)
 * - recordPayment(): paid_amount/balance_owed change (row is updated)
 * - closeTicketAfterConfirmation(): installation_date/warranty_expires_at
 *   get stamped (row is updated)
 * - closeOrder(): a final, redundant sync — balance_owed is already 0 by
 *   the last recordPayment call, this is just a safety net
 *
 * category/brand/product_name/variant/list_price come from the linked
 * product (joined via tickets.product_code); discount/balance_owed are
 * Postgres's own generated columns — none of that is typed by hand.
 *
 * Matched to an existing row by phone_number + bill_date + sold_price
 * (stable for a given sale's whole lifetime, since sold_price never
 * changes after the sale is made) — if no row matches yet, one is added.
 */
export async function syncOrderToSalesSheet(orderId: string): Promise<void> {
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

  await upsertRowByHeader(SALES_TAB, valuesByColumn, ['phone_number', 'bill_date', 'sold_price']);
}

/**
 * Same as syncOrderToSalesSheet(), but never throws — every call site
 * calls this instead, right after its own DB write has already
 * committed, same fail-safe shape as Telegram notifications (§10.5). A
 * Sheets outage or the Editor-access permission problem gets logged to
 * notifications_log as sales_sheet_failed, never blocks the real
 * operation (a sale being made, a payment being recorded, a job being
 * closed) that triggered it.
 */
export async function syncOrderToSalesSheetSafely(orderId: string): Promise<void> {
  try {
    await syncOrderToSalesSheet(orderId);
  } catch (e) {
    await logNotification('sales_sheet_failed', 'failed', (e as Error).message);
  }
}
