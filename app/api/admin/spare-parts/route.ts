import { requireUser, handleApiError } from '@/lib/api-auth';
import { getSpareParts } from '@/lib/services/spareParts';

// The spare-parts price list, for /admin/spare-parts's Sell Spare Part
// picker (formerly also read by a technician's own Mark Done picker,
// before the staff self-service portal was removed — see CLAUDE.md's
// staff-portal-removal note — so this moved from /api/staff/spare-parts
// to here, and no longer needs to allow service_staff at all).
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);
    const parts = await getSpareParts();
    return Response.json({ parts });
  } catch (err) {
    return handleApiError(err);
  }
}
