import { requireUser, handleApiError } from '@/lib/api-auth';
import { getAreas } from '@/lib/services/areas';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
export const dynamic = 'force-dynamic';

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
