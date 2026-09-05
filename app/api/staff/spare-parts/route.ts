import { requireUser, handleApiError } from '@/lib/api-auth';
import { getSpareParts } from '@/lib/services/spareParts';

export async function GET() {
  try {
    // admin/owner included so the office spare-part sale form can read the
    // same list a tech's Mark Done picker uses.
    await requireUser(['service_staff', 'admin', 'owner']);
    const parts = await getSpareParts();
    return Response.json({ parts });
  } catch (err) {
    return handleApiError(err);
  }
}
