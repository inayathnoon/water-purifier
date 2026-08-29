import { requireUser, handleApiError } from '@/lib/api-auth';
import { closeOrder } from '@/lib/services/orders';

// §7.5/§13.1: the single most important rule — refused here in the service
// layer with a clear message, and again by the DB trigger no matter how
// this row gets updated in the future.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;

    const order = await closeOrder(id);
    return Response.json({ order });
  } catch (err) {
    return handleApiError(err);
  }
}
