import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
export const dynamic = 'force-dynamic';

// §11.3: only an owner decides — this whole namespace is owner-only,
// unlike most admin/owner-interchangeable routes elsewhere in the app.
export async function GET() {
  try {
    await requireUser(['owner']);

    const { data, error } = await supabaseAdmin
      .from('leave_requests')
      .select('*, users:requester_id(name)')
      .order('status', { ascending: true }) // pending first
      .order('created_at', { ascending: false });

    if (error) throw error;
    return Response.json({ requests: data });
  } catch (err) {
    return handleApiError(err);
  }
}
