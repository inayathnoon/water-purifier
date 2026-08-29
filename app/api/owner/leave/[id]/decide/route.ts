import { requireUser, handleApiError } from '@/lib/api-auth';
import { decideLeave } from '@/lib/services/leave';

// §11.3/§11.4: owner-only; denying requires a reason (enforced in the
// service layer and again by a DB trigger).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(['owner']);
    const { id } = await params;
    const body = await request.json();

    const leave = await decideLeave(id, user.id, body.decision, body.reason);
    return Response.json({ leave });
  } catch (err) {
    return handleApiError(err);
  }
}
