import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { completeJob, closeTicketAfterConfirmation } from '@/lib/services/tickets';
import { todayIST } from '@/lib/dates';

// "Installed" / "Service completed" — the admin dashboard's "Finished
// Installation/Service" card, plus Installations/Services/Sell Spare Part.
// There's no technician login to record this themselves any more (see
// CLAUDE.md's staff-portal-removal note) — the tech reports back over
// Telegram/phone, and admin records it here.
//
// This closes the ticket in the same request, right after marking it
// done — not two separate client-orchestrated fetches to this route and
// then /close. That used to be three copies of the exact same two-fetch
// chain (here, admin/installations, admin/spare-parts), each with a gap
// between the calls a network blip could land in: mark-done succeeds,
// the browser's second request to /close never arrives or the tab is
// closed in between, and the ticket is left sitting in 'completed'
// forever with no button anywhere that can reach it (found live —
// 2026-09-16 — as 12 real service visits stranded exactly that way,
// every one dated the day this two-step flow first shipped). Since
// nothing has ever needed to see a job pause at 'completed' — every
// caller of this route wants it done *and* confirmed in one motion —
// there's no reason for two round trips to exist at all. completeJob()
// itself is unchanged except for what it accepts; passing the ticket's
// own assigned_to_id (not the admin's own id) as the caller keeps its
// ownership check meaningful and the completion notification's
// technician name correct. Admin/owner-only, so returning the order
// (with real prices) alongside the ticket is fine here — unlike
// completeJob()'s own §13.4-scrubbed response, which a technician could
// once have seen.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const { data: ticket, error } = await supabaseAdmin
      .from('tickets')
      .select('assigned_to_id')
      .eq('id', id)
      .single();
    if (error || !ticket) throw new ApiError(404, 'Ticket not found');
    if (!ticket.assigned_to_id) throw new ApiError(400, 'This job has no assigned technician');

    const actualDate = body.actualDate || todayIST();
    if (actualDate > todayIST()) throw new ApiError(400, 'Completion date cannot be in the future');

    await completeJob(id, ticket.assigned_to_id, {
      actualDate,
      notes: body.notes ?? '',
    });
    const result = await closeTicketAfterConfirmation(id);

    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
