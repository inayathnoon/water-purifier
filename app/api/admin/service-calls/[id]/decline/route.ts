import { requireUser, handleApiError } from '@/lib/api-auth';
import { declineYearlyService } from '@/lib/services/warranty';

// §8.6: if the customer declines, that's recorded too.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const ticket = await declineYearlyService(id, body.note);
    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
