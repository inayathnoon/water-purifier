import { requireUser, handleApiError } from '@/lib/api-auth';
import { unassignJob } from '@/lib/services/tickets';

// "Put back to dispatch" — works the same for an installation or a
// service visit, so this lives under the generic /tickets path rather
// than being duplicated under /installations and /service-calls.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const ticket = await unassignJob(id);
    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
