import { requireUser, handleApiError } from '@/lib/api-auth';
import { logPaymentCall } from '@/lib/services/orders';
import { supabaseAdmin } from '@/lib/db';
import { ApiError } from '@/lib/api-auth';

// §7.3: while anything is owed, the admin calls every 3 days.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const { data: order, error } = await supabaseAdmin.from('orders').select('ticket_id').eq('id', id).single();
    if (error || !order) throw new ApiError(404, 'Order not found');

    const updated = await logPaymentCall(id, body.note, order.ticket_id, user.id);
    return Response.json({ order: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
