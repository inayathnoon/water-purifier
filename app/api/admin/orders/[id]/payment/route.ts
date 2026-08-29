import { requireUser, handleApiError } from '@/lib/api-auth';
import { recordPayment } from '@/lib/services/orders';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const order = await recordPayment(id, Number(body.amount));
    return Response.json({ order });
  } catch (err) {
    return handleApiError(err);
  }
}
