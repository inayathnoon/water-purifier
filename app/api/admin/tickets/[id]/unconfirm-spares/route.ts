import { requireUser, handleApiError } from '@/lib/api-auth';
import { unconfirmSpares } from '@/lib/services/sparePartSales';

// Undo "No parts used" — clicked by mistake, actually need to record
// real parts. Only works before the job's been marked done.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;

    const ticket = await unconfirmSpares(id);
    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
