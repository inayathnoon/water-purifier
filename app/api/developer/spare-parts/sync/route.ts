import { requireUser, handleApiError } from '@/lib/api-auth';
import { syncSpareParts } from '@/lib/services/spareParts';

export async function POST() {
  try {
    await requireUser(['developer']);
    const parts = await syncSpareParts();
    return Response.json({ parts });
  } catch (err) {
    return handleApiError(err);
  }
}
