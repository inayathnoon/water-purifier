import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

const MIN_EXPLANATION_WORDS = 30;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Enquiries (§5)
// ---------------------------------------------------------------------------

export async function createEnquiry(input: { customerId: string; productInterest: string; createdBy: string }) {
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .insert({
      customer_id: input.customerId,
      kind: 'enquiry',
      status: 'open',
      enquiry_product_interest: input.productInterest,
    })
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  return data;
}

/** §5.2: log a call attempt. Bumping call_count happens via DB trigger. */
export async function logCall(ticketId: string, note: string, createdBy: string) {
  if (!note.trim()) throw new ApiError(400, 'A call note is required');

  const { data, error } = await supabaseAdmin
    .from('call_log')
    .insert({ ticket_id: ticketId, note, created_by: createdBy })
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  return data;
}

async function getTicketOrThrow(ticketId: string) {
  const { data, error } = await supabaseAdmin.from('tickets').select('*').eq('id', ticketId).single();
  if (error || !data) throw new ApiError(404, 'Ticket not found');
  return data;
}

/**
 * §5.3/§5.4/§5.5/§13.2: the single place that closes an enquiry one of four
 * ways. This is the one enforcement point for the 30-word rule and the
 * "must have called at least once" rule — no screen can bypass it because
 * no screen writes to tickets.status/closure_* directly.
 */
export async function closeEnquiry(
  ticketId: string,
  action: 'call_back_later' | 'pass_to_owner' | 'mark_inactive' | 'convert',
  input: { explanation?: string; callbackDate?: string; agreedPrice?: number }
) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.kind !== 'enquiry') throw new ApiError(400, 'Not an enquiry');
  if (ticket.status !== 'open') throw new ApiError(400, 'Enquiry is already closed');

  if (action === 'call_back_later') {
    if (!input.callbackDate) throw new ApiError(400, 'A callback date is required');
    const { data, error } = await supabaseAdmin
      .from('tickets')
      .update({ callback_date: input.callbackDate })
      .eq('id', ticketId)
      .select('*')
      .single();
    if (error) throw new ApiError(500, error.message);
    return data; // stays open — §5.3: "returns to the list on that day"
  }

  if (action === 'pass_to_owner' || action === 'mark_inactive') {
    // §5.5: an enquiry that has never been called cannot be passed to an owner.
    if (action === 'pass_to_owner' && ticket.call_count < 1) {
      throw new ApiError(400, 'This enquiry has never been called — try calling first');
    }
    // §5.4/§13.2: 30+ words required, no shorter explanation accepted.
    const explanation = (input.explanation ?? '').trim();
    if (wordCount(explanation) < MIN_EXPLANATION_WORDS) {
      throw new ApiError(
        400,
        `Explanation must be at least ${MIN_EXPLANATION_WORDS} words (got ${wordCount(explanation)})`
      );
    }

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .update({
        status: action === 'pass_to_owner' ? 'passed_to_owner' : 'inactive',
        closure_reason: action,
        closure_explanation: explanation,
      })
      .eq('id', ticketId)
      .select('*')
      .single();
    if (error) throw new ApiError(500, error.message);
    return data;
  }

  if (action === 'convert') {
    if (input.agreedPrice == null || input.agreedPrice < 0) {
      throw new ApiError(400, 'A valid agreed price is required to convert');
    }

    // §5.7: price is recorded now, at the moment the customer says yes —
    // even though installation may happen a week later.
    const { data: closedEnquiry, error: closeError } = await supabaseAdmin
      .from('tickets')
      .update({ status: 'closed', closure_reason: 'convert' })
      .eq('id', ticketId)
      .select('*')
      .single();
    if (closeError) throw new ApiError(500, closeError.message);

    const { data: installation, error: installError } = await supabaseAdmin
      .from('tickets')
      .insert({
        customer_id: closedEnquiry.customer_id,
        kind: 'installation',
        status: 'open', // not yet booked to a tech/date
        agreed_price: input.agreedPrice,
      })
      .select('*')
      .single();
    if (installError) throw new ApiError(500, installError.message);

    return installation;
  }

  throw new ApiError(400, 'Unknown action');
}

// ---------------------------------------------------------------------------
// Installations & service visits (§6) — booking, completion, cancellation
// ---------------------------------------------------------------------------

/**
 * §6.1/§6.4: book a job to a person, date, and half-day. The DB constraint
 * on tickets.assigned_to_id already refuses anyone but service_staff — this
 * re-checks so the caller gets a clear message instead of a raw SQL error.
 * §6.3: no limit on jobs per half-day — the UI surfaces load, doesn't block it.
 */
export async function bookJob(
  ticketId: string,
  input: {
    assignedToId: string;
    bookedDate: string;
    bookedHalfDay: 'morning' | 'afternoon' | 'evening';
    location: 'home' | 'office';
  }
) {
  const { data: assignee, error: assigneeError } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', input.assignedToId)
    .single();

  if (assigneeError || !assignee) throw new ApiError(400, 'Assignee not found');
  if (assignee.role !== 'service_staff') {
    // §13.5: a job can only be given to service staff — never owner or admin.
    throw new ApiError(400, 'Jobs can only be assigned to service staff');
  }

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update({
      assigned_to_id: input.assignedToId,
      booked_date: input.bookedDate,
      booked_half_day: input.bookedHalfDay,
      location: input.location,
      status: 'booked',
    })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  return data;
}

/**
 * §6.5/§6.6: technician records what actually happened. They can start/finish
 * their own job but cannot change assignee, booked date, or warranty — so
 * this function simply never accepts those fields as input. If a client
 * sends them anyway, they're ignored, not silently applied.
 */
export async function completeJob(
  ticketId: string,
  callerId: string,
  input: {
    actualDate: string;
    actualStartTime: string;
    actualEndTime: string;
    notes: string;
    partsUsed?: string;
    chargeAmount?: number;
  }
) {
  const ticket = await getTicketOrThrow(ticketId);

  if (ticket.assigned_to_id !== callerId) {
    throw new ApiError(403, 'You can only complete your own jobs');
  }
  if (ticket.status !== 'booked') {
    throw new ApiError(400, 'Job is not in a bookable-to-complete state');
  }

  const update: Record<string, unknown> = {
    actual_date: input.actualDate,
    actual_start_time: input.actualStartTime,
    actual_end_time: input.actualEndTime,
    actual_notes: input.notes,
    status: 'completed', // §6.7: completed, not closed — returns to admin
  };

  if (ticket.kind === 'service_visit') {
    update.parts_used = input.partsUsed ?? null;
    // §8.4: the technician does record what a chargeable visit costs.
    // §8.5/§13.3: but *whether* it's chargeable at all is worked out from
    // installation_date, never taken from the form — so a visit inside the
    // warranty year is forced to 0 no matter what the tech typed.
    update.charge_amount = isWithinWarranty(ticket.installation_date, input.actualDate)
      ? 0
      : input.chargeAmount ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update(update)
    .eq('id', ticketId)
    .select(
      // §13.4: service staff never see a selling price — this select list is
      // the enforcement point. `agreed_price` (the order's sale price) is
      // deliberately excluded even though it lives on this same row.
      'id, kind, status, actual_date, actual_start_time, actual_end_time, actual_notes, parts_used, charge_amount'
    )
    .single();
  if (error) throw new ApiError(500, error.message);
  return data;
}

function isWithinWarranty(installationDate: string | null, checkDate: string): boolean {
  if (!installationDate) return false;
  const oneYearLater = new Date(installationDate);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  return new Date(checkDate) <= oneYearLater;
}

/** §6.8: cancelling a job requires a reason. */
export async function cancelJob(ticketId: string, reason: string) {
  if (!reason.trim()) throw new ApiError(400, 'A cancellation reason is required');

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update({ status: 'inactive', cancellation_reason: reason })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  return data;
}

/**
 * §6.7/§7.1: admin closes the ticket after confirming with the customer.
 * For an installation, this is the single moment the order is created
 * (§7.1), using the price agreed at conversion time (§5.7).
 */
export async function closeTicketAfterConfirmation(ticketId: string) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.status !== 'completed') {
    throw new ApiError(400, 'Job must be completed before it can be closed');
  }

  const update: Record<string, unknown> = { status: 'closed' };

  if (ticket.kind === 'installation') {
    // §8.1: warranty is dated from the day the unit was actually fitted —
    // the technician's recorded actual_date (§6.5), not today's date, since
    // closing can happen days after the visit.
    if (!ticket.actual_date) {
      throw new ApiError(400, 'Job has no recorded completion date — cannot start the warranty clock');
    }
    const warrantyExpires = new Date(ticket.actual_date);
    warrantyExpires.setFullYear(warrantyExpires.getFullYear() + 1);
    update.installation_date = ticket.actual_date;
    update.warranty_expires_at = warrantyExpires.toISOString().slice(0, 10);
  }

  const { data: closed, error: closeError } = await supabaseAdmin
    .from('tickets')
    .update(update)
    .eq('id', ticketId)
    .select('*')
    .single();
  if (closeError) throw new ApiError(500, closeError.message);

  if (ticket.kind === 'installation') {
    if (ticket.agreed_price == null) {
      throw new ApiError(400, 'Installation has no agreed price recorded — cannot create order');
    }
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        ticket_id: ticketId,
        list_price: ticket.agreed_price, // list_price may later be overridden by product lookup
        sold_price: ticket.agreed_price,
      })
      .select('*')
      .single();
    if (orderError) throw new ApiError(500, orderError.message);
    return { ticket: closed, order };
  }

  return { ticket: closed, order: null };
}
