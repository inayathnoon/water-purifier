import { requireUser, handleApiError } from '@/lib/api-auth';
import { updateAdHocServiceRequest } from '@/lib/services/tickets';

// Correcting an ad-hoc service request's own details — only while it
// hasn't been visited yet. See updateAdHocServiceRequest().
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const ticket = await updateAdHocServiceRequest(id, {
      productInterest: body.productInterest,
      issueNote: body.issueNote,
      location: body.location,
    });

    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
