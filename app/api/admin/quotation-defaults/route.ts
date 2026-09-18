import { requireUser, handleApiError } from '@/lib/api-auth';
import { getQuotationDefaults, updateQuotationDefaults } from '@/lib/services/quotations';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser(['admin', 'owner']);
    const defaults = await getQuotationDefaults();
    return Response.json({ defaults });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();
    const defaults = await updateQuotationDefaults(body);
    return Response.json({ defaults });
  } catch (err) {
    return handleApiError(err);
  }
}
