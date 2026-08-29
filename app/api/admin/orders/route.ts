import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// §15.6: at any moment, the business can say exactly how much is
// outstanding and who owes it — this is that list.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('*, tickets(customer_id, customers(name, phone_number))')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return Response.json({ orders: data });
  } catch (err) {
    return handleApiError(err);
  }
}
