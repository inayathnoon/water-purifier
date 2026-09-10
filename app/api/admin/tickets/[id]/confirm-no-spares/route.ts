import { requireUser, handleApiError } from '@/lib/api-auth';
import { confirmNoSparesNeeded } from '@/lib/services/sparePartSales';

// The other way to satisfy the spares-step gate on a service visit — the
// admin checked and genuinely nothing was used. Reachable from
// /admin/spare-parts?ticketId=... next to the real "Record sale" form.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;

    const ticket = await confirmNoSparesNeeded(id);
    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
