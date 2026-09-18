import { requireUser, handleApiError } from '@/lib/api-auth';
import { getSpareParts } from '@/lib/services/spareParts';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
export const dynamic = 'force-dynamic';

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
