import { requireUser, handleApiError } from '@/lib/api-auth';
import { bookJob } from '@/lib/services/tickets';

// §6.1/§6.4: book to a person, date, half-day. §6.3: no limit per half-day —
// enforced nowhere; the UI just shows load so admin can decide.
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
