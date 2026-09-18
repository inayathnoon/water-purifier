import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
export const dynamic = 'force-dynamic';

// §15.6: at any moment, the business can say exactly how much is
// outstanding and who owes it — this is that list.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select(
        '*, tickets(status, customer_id, planned_installation_date, actual_date, installation_date, warranty_expires_at, enquiry_product_interest, actual_notes, customers(name, phone_number, address, area), products(brand, name, variant, code, master_sku))'
      )
      .order('created_at', { ascending: false });

    if (error) throw error;
    return Response.json({ orders: data });
  } catch (err) {
    return handleApiError(err);
  }
}
