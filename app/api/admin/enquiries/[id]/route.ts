import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { updateEnquiry } from '@/lib/services/tickets';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
export const dynamic = 'force-dynamic';

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

    // Newest first — reverted 2026-09-07 at the business's explicit
    // request; the most recent call is what matters when checking in on
    // an enquiry, not scrolling to the bottom of a history.
    const { data: calls, error: callsError } = await supabaseAdmin
      .from('call_log')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: false });
    if (callsError) throw callsError;

    // Backs the "This turned out to already be a purchase" link — only
    // worth surfacing at all if there's real evidence: a purchase for
    // this same phone number made in roughly the last month. Otherwise
    // it's a prompt with nothing behind it every single time.
    const phoneNumber = (ticket as { customers?: { phone_number?: string } }).customers?.phone_number;
    let hasRecentMatchingPurchase = false;
    if (phoneNumber) {
      const { data: matchingCustomers } = await supabaseAdmin.from('customers').select('id').eq('phone_number', phoneNumber);
      const customerIds = (matchingCustomers ?? []).map((c) => c.id);
      if (customerIds.length > 0) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: matches } = await supabaseAdmin
          .from('tickets')
          .select('id')
          .eq('kind', 'installation')
          .in('customer_id', customerIds)
          .gte('created_at', thirtyDaysAgo)
          .limit(1);
        hasRecentMatchingPurchase = (matches?.length ?? 0) > 0;
      }
    }

    return Response.json({ ticket, calls: calls ?? [], hasRecentMatchingPurchase });
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
