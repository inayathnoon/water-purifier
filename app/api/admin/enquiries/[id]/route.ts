import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// §4.3: full history visible on one page — ticket + customer + call log.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .select('*, customers(*)')
      .eq('id', id)
      .single();
    if (ticketError) throw ticketError;

    const { data: calls, error: callsError } = await supabaseAdmin
      .from('call_log')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: false });
    if (callsError) throw callsError;

    return Response.json({ ticket, calls: calls ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}
