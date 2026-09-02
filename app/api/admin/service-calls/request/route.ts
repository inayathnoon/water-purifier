import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { createServiceRequest } from '@/lib/services/warranty';

// "New Service" — the admin's explicit decision to actually pursue a due
// yearly service call, creating the real open ticket. From here it goes
// through the same book → complete → confirm-and-close flow as any
// other service visit (/admin/service-calls handles the rest).
export async function POST(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const body = await request.json();
    const installationTicketId = body.installationTicketId as string;
    if (!installationTicketId) throw new ApiError(400, 'installationTicketId is required');

    const ticket = await createServiceRequest(installationTicketId);
    return Response.json({ ticket }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
