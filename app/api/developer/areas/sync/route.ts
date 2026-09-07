import { requireUser, handleApiError } from '@/lib/api-auth';
import { syncAreas } from '@/lib/services/areas';

export async function POST() {
  try {
    await requireUser(['developer']);
    const areas = await syncAreas();
    return Response.json({ areas });
  } catch (err) {
    return handleApiError(err);
  }
}
