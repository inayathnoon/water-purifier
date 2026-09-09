import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { requestLeave } from '@/lib/services/leave';

// §11.1, filed on a technician's behalf — there's no staff login for them
// to submit their own request any more (see CLAUDE.md's staff-portal
// removal note). requestLeave() itself is unchanged; it never assumed
// the requester was the caller, only that a real requesterId was given.
export async function POST(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const body = await request.json();
    if (!body.staffId) throw new ApiError(400, 'A staff member is required');

    const leave = await requestLeave(body.staffId, body.startDate, body.endDate, body.reason);
    return Response.json({ leave }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
