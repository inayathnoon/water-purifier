import { requireUser, handleApiError } from '@/lib/api-auth';
import { confirmOrderSatisfaction } from '@/lib/services/orders';

// Follow-up satisfaction call, separate from the installation-confirm
// step — requires a short note, not just a click (§ confirmOrderSatisfaction).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const order = await confirmOrderSatisfaction(id, body.note ?? '');
    return Response.json({ order });
  } catch (err) {
    return handleApiError(err);
  }
}
