import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { selfCompleteInstallation } from '@/lib/services/tickets';
import { todayIST } from '@/lib/dates';

// "No staff" on New Purchase's Assign to Staff dropdown — the admin/owner
// installed it themselves, so there's no technician to dispatch at all.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const actualDate = body.actualDate || todayIST();
    if (actualDate > todayIST()) throw new ApiError(400, 'Completion date cannot be in the future');

    const result = await selfCompleteInstallation(id, actualDate);
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
