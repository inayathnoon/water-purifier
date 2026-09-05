import { requireUser, handleApiError } from '@/lib/api-auth';
import { getSpareParts } from '@/lib/services/spareParts';

export async function GET() {
  try {
    await requireUser(['service_staff']);
    const parts = await getSpareParts();
    return Response.json({ parts });
  } catch (err) {
    return handleApiError(err);
  }
}
