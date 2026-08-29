import { requireUser, handleApiError } from '@/lib/api-auth';
import { bookJob } from '@/lib/services/tickets';

// §8.3: if service is needed, a service visit is booked exactly like an
// installation — same bookJob() as /api/admin/installations/[id]/book.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const ticket = await bookJob(id, {
      assignedToId: body.assignedToId,
      bookedDate: body.bookedDate,
      bookedHalfDay: body.bookedHalfDay,
      location: body.location,
    });

    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
