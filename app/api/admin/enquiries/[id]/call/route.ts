import { requireUser, handleApiError } from '@/lib/api-auth';
import { logCall } from '@/lib/services/tickets';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const call = await logCall(id, body.note, user.id);
    return Response.json({ call }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
