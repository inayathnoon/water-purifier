import { requireUser, handleApiError } from '@/lib/api-auth';
import { editCompletedServiceVisit } from '@/lib/services/tickets';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(['service_staff']);
    const { id } = await params;
    const body = await request.json();

    const ticket = await editCompletedServiceVisit(id, user.id, {
      notes: body.notes,
      partsUsed: body.partsUsed,
      chargeAmount: body.chargeAmount,
      chargeBreakdown: body.chargeBreakdown,
    });

    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
