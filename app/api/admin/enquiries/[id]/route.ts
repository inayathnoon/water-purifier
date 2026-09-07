import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { updateEnquiry } from '@/lib/services/tickets';

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

// Correcting what was typed on an enquiry — only while it's still open.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const ticket = await updateEnquiry(id, {
      productInterest: body.productInterest,
      source: body.source,
      referrerName: body.referrerName,
      referrerPhone: body.referrerPhone,
      sourceOtherNote: body.sourceOtherNote,
      enquiryDate: body.enquiryDate,
    });

    return Response.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}

// Deletes an enquiry outright — for a mistaken or duplicate entry, not a
// real "closed with no sale" outcome (that's mark_inactive, which keeps the
// record). Refuses anything that isn't actually an enquiry ticket, so this
// route can never be used to delete an installation/service visit and its
// order history by mistake.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;

    const { data: ticket, error: findError } = await supabaseAdmin
      .from('tickets')
      .select('kind')
      .eq('id', id)
      .single();
    if (findError || !ticket) throw new Error('Enquiry not found');
    if (ticket.kind !== 'enquiry') {
      return Response.json({ error: 'This is not an enquiry — cannot delete it here' }, { status: 400 });
    }

    await supabaseAdmin.from('call_log').delete().eq('ticket_id', id);
    const { error: deleteError } = await supabaseAdmin.from('tickets').delete().eq('id', id);
    if (deleteError) throw deleteError;

    return Response.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
