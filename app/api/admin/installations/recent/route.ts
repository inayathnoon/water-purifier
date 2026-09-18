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

// Backs the enquiry page's "Link to Existing Purchase" picker — recent
// installations (any status) to scroll through and pick from, for a sale
// that turns out to already be recorded separately from this enquiry.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('id, status, agreed_price, created_at, customers(name, phone_number)')
      .eq('kind', 'installation')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;
    return Response.json({ installations: data });
  } catch (err) {
    return handleApiError(err);
  }
}
