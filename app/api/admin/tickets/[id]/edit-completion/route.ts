import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { editCompletedJob } from '@/lib/services/tickets';

// Correcting the completion date/notes on a job that's already been
// marked done — reachable from /admin/orders (installation) and
// /admin/service-calls (service visit), the replacement for the removed
// technician-facing mistake-fix window.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (!body.actualDate) throw new ApiError(400, 'A completion date is required');

    const ticket = await editCompletedJob(id, user.id, {
      actualDate: body.actualDate,
      notes: body.notes ?? '',
      assignedToId: body.assignedToId || undefined,
    });
    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
