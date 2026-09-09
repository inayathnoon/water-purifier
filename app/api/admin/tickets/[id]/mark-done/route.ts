import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { completeJob } from '@/lib/services/tickets';
import { todayIST, HALF_DAY_TIMES } from '@/lib/dates';

// "Installed" / "Service completed" — part 1 of the admin dashboard's
// "Finished Installation/Service" card. There's no technician login to
// record this themselves any more (see CLAUDE.md's staff-portal-removal
// note) — the tech reports back over Telegram/phone, and admin records it
// here. completeJob() itself is unchanged except for what it accepts;
// passing the ticket's own assigned_to_id (not the admin's own id) as the
// caller keeps its ownership check meaningful and the completion
// notification's technician name correct.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const { data: ticket, error } = await supabaseAdmin
      .from('tickets')
      .select('assigned_to_id, booked_half_day')
      .eq('id', id)
      .single();
    if (error || !ticket) throw new ApiError(404, 'Ticket not found');
    if (!ticket.assigned_to_id) throw new ApiError(400, 'This job has no assigned technician');

    const times = HALF_DAY_TIMES[ticket.booked_half_day ?? 'morning'];
    const result = await completeJob(id, ticket.assigned_to_id, {
      actualDate: todayIST(),
      actualStartTime: times.start,
      actualEndTime: times.end,
      notes: body.notes ?? '',
    });

    return Response.json({ ticket: result });
  } catch (err) {
    return handleApiError(err);
  }
}
