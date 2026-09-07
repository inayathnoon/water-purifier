import { requireUser, handleApiError } from '@/lib/api-auth';
import { getAreas } from '@/lib/services/areas';

// Backs every AreaSelect autocomplete — admin/owner (every screen that
// uses it) plus developer (the "View As" previews).
export async function GET() {
  try {
    await requireUser(['admin', 'owner', 'developer']);
    const areas = await getAreas();
    return Response.json({ areas });
  } catch (err) {
    return handleApiError(err);
  }
}
