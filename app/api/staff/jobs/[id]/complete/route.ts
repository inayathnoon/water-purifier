import { requireUser, handleApiError } from '@/lib/api-auth';
import { completeJob } from '@/lib/services/tickets';

// §6.5/§6.6: technician records the real date/times/notes. Can only touch
// their own job; assignee/booked-date/warranty fields are never accepted
// as input here, so a tampered request can't move them.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(['service_staff']);
    const { id } = await params;
    const body = await request.json();

    const ticket = await completeJob(id, user.id, {
      actualDate: body.actualDate,
      actualStartTime: body.actualStartTime,
      actualEndTime: body.actualEndTime,
      notes: body.notes,
      partsUsed: body.partsUsed,
      chargeAmount: body.chargeAmount != null ? Number(body.chargeAmount) : undefined,
    });

    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
