import { requireUser, handleApiError } from '@/lib/api-auth';
import { cancelJob } from '@/lib/services/tickets';

// §6.8: cancelling a job requires a reason.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const ticket = await cancelJob(id, body.reason);
    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
