import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// A small generic single-ticket read — currently only used by Sell Spare
// Part (linked from the dashboard) to know whether the job it's tagging
// is still within warranty (to show/hide the flat "Service charges" line
// and the free-parts message before the form is submitted — the actual
// §13.3 enforcement happens server-side in recordSparePartSale()) and
// whether it's already satisfied the spares-step gate.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('id, kind, installation_date, spares_confirmed, customers(name, phone_number)')
      .eq('id', id)
      .single();
    if (error || !data) throw new ApiError(404, 'Ticket not found');

    return Response.json({ ticket: data });
  } catch (err) {
    return handleApiError(err);
  }
}
