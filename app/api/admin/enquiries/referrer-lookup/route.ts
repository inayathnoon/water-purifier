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

// Autofill: typing a referrer's phone number that's referred someone
// before fills in their name, the same way a repeat customer's phone
// number already does elsewhere in the app.
export async function GET(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const phone = new URL(request.url).searchParams.get('phone')?.trim();
    if (!phone) return Response.json({ referrerName: null });

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('referrer_name')
      .eq('enquiry_source', 'referral')
      .eq('referrer_phone', phone)
      .not('referrer_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return Response.json({ referrerName: data?.referrer_name ?? null });
  } catch (err) {
    return handleApiError(err);
  }
}
