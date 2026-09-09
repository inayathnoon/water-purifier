import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// Backs the Telegram deep links (§10.4): any signed-in user gets routed to
// wherever their role can act on this ticket. requireUser() is the auth
// gate — someone not signed in never reaches this far, and middleware
// bounces them to /auth/login first, landing them right back here after.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    if (user.role === 'service_staff') {
      // See CLAUDE.md's staff-portal-removal note — there's no page in
      // the app for this account any more; jobs are assigned/reported
      // over Telegram, not clicked into from a deep link.
      return Response.json({ target: '/dashboard' });
    }

    const { data: ticket, error } = await supabaseAdmin.from('tickets').select('kind').eq('id', id).single();
    if (error || !ticket) throw error;

    const target =
      ticket.kind === 'enquiry'
        ? `/admin/enquiries/${id}`
        : ticket.kind === 'service_visit'
          ? '/admin/service-calls'
          : '/admin/installations';

    return Response.json({ target });
  } catch (err) {
    return handleApiError(err);
  }
}
