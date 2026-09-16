import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { notifyJobAssigned, notifyJobCompleted, notifyEnquiryPassedToOwner } from './notifications';
import { syncOrderToSalesSheetSafely, removeOrderFromSalesSheetSafely } from './salesSheet';
import { syncServiceToSheetSafely, removeServiceFromSheetSafely } from './serviceSheet';
import { syncEnquiryToSheetSafely, removeEnquiryFromSheetSafely } from './enquirySheet';
import { logTicketPaymentToSheetSafely } from './paymentsSheet';
import { closeOrder } from './orders';
import { todayIST, halfDayNowIST } from '../dates';

const MIN_EXPLANATION_WORDS = 5;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Enquiries (§5)
// ---------------------------------------------------------------------------

export async function createEnquiry(input: {
  customerId: string;
  productInterest: string;
  createdBy: string;
  source?: 'general' | 'water_test' | 'ready_to_buy' | 'referral' | 'other';
  referrerName?: string;
  referrerPhone?: string;
  // Only meaningful (and required) when source is 'other' — what "other"
  // actually was, since that value doesn't speak for itself the way the
  // rest of the list does.
  sourceOtherNote?: string;
  // Defaults to now (today) if not given — for entering an enquiry a day
  // or two after it actually happened, not for scheduling a future one.
  enquiryDate?: string;
}) {
  if (input.source === 'referral' && !input.referrerPhone?.trim()) {
    throw new ApiError(400, 'A referrer phone number is required for a referral');
  }
  if (input.source === 'other' && !input.sourceOtherNote?.trim()) {
    throw new ApiError(400, 'Please specify how this enquiry came in');
  }
  if (input.enquiryDate && input.enquiryDate > todayIST()) {
    throw new ApiError(400, 'Enquiry date cannot be in the future');
  }

  // Noon UTC, not midnight — a plain date-only value parsed at midnight
  // shifts a day in either direction depending on server timezone (the
  // exact bug documented in CLAUDE.md's historical-import note, and
  // already worked around the same way for a purchase's Bill Date).
  const enquiryCreatedAt = input.enquiryDate ? `${input.enquiryDate}T12:00:00Z` : undefined;

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .insert({
      customer_id: input.customerId,
      kind: 'enquiry',
      status: 'open',
      enquiry_product_interest: input.productInterest,
      product_interest: input.productInterest || null,
      enquiry_source: input.source ?? 'general',
      referrer_name: input.source === 'referral' ? input.referrerName ?? null : null,
      referrer_phone: input.source === 'referral' ? input.referrerPhone ?? null : null,
      source_other_note: input.source === 'other' ? input.sourceOtherNote ?? null : null,
      ...(enquiryCreatedAt ? { created_at: enquiryCreatedAt } : {}),
    })
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);

  // Registered the moment it's created, same reasoning as Sales/Service.
  // Fire-and-forget — see recordPayment() in orders.ts for why every
  // sheet sync in this file follows this same pattern from here on.
  syncEnquiryToSheetSafely(data.id).catch(() => {});
  return data;
}

/**
 * Correcting what was typed on an enquiry — wrong product interest, wrong
 * source, a referrer detail fixed after the fact. Only while it's still
 * `open`: once closed, `closure_reason`/`closure_explanation` are the
 * record of what actually happened and editing the enquiry's own details
 * out from under that would muddy why it was closed the way it was —
 * the customer's own details are already editable separately, via the
 * Customer Directory.
 */
export async function updateEnquiry(
  ticketId: string,
  updates: {
    productInterest?: string;
    source?: 'general' | 'water_test' | 'ready_to_buy' | 'referral' | 'other';
    referrerName?: string;
    referrerPhone?: string;
    sourceOtherNote?: string;
    enquiryDate?: string;
  }
) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.kind !== 'enquiry') throw new ApiError(400, 'Not an enquiry');
  if (ticket.status !== 'open') throw new ApiError(400, 'Only an open enquiry can be edited here');

  const source = updates.source ?? ticket.enquiry_source;
  if (source === 'referral' && !(updates.referrerPhone ?? ticket.referrer_phone)?.trim()) {
    throw new ApiError(400, 'A referrer phone number is required for a referral');
  }
  if (source === 'other' && !(updates.sourceOtherNote ?? ticket.source_other_note)?.trim()) {
    throw new ApiError(400, 'Please specify how this enquiry came in');
  }
  if (updates.enquiryDate && updates.enquiryDate > todayIST()) {
    throw new ApiError(400, 'Enquiry date cannot be in the future');
  }

  const patch: Record<string, unknown> = {};
  if (updates.productInterest !== undefined) {
    patch.enquiry_product_interest = updates.productInterest;
    patch.product_interest = updates.productInterest || null;
  }
  if (updates.source !== undefined) patch.enquiry_source = updates.source;
  if (source === 'referral') {
    if (updates.referrerName !== undefined) patch.referrer_name = updates.referrerName || null;
    if (updates.referrerPhone !== undefined) patch.referrer_phone = updates.referrerPhone || null;
  } else if (updates.source !== undefined) {
    // Switched away from referral — the old referrer detail no longer applies.
    patch.referrer_name = null;
    patch.referrer_phone = null;
  }
  if (source === 'other') {
    if (updates.sourceOtherNote !== undefined) patch.source_other_note = updates.sourceOtherNote || null;
  } else if (updates.source !== undefined) {
    // Switched away from 'other' — the old note no longer applies.
    patch.source_other_note = null;
  }

  // date is part of the Enquiry sheet's match key (phone_number + date) —
  // the old row has to be un-found under the old date, then the new one
  // synced, in that order, or a stale duplicate sits next to the
  // corrected row.
  const oldDate = ticket.created_at.slice(0, 10);
  const dateChanging = !!(updates.enquiryDate && updates.enquiryDate !== oldDate);
  if (dateChanging) {
    patch.created_at = `${updates.enquiryDate}T12:00:00Z`;
  }

  const { data, error } = await supabaseAdmin.from('tickets').update(patch).eq('id', ticketId).select('*').single();
  if (error) throw new ApiError(500, error.message);

  // Fire-and-forget — the write above has already committed. The
  // remove-then-sync sequence stays chained in one background task
  // (rather than two independent fire-and-forget calls) since both hit
  // the same sheet and running them out of order or concurrently could
  // race into exactly the duplicate-row bug this ordering prevents.
  (async () => {
    if (dateChanging) {
      const { data: customer } = await supabaseAdmin.from('customers').select('phone_number').eq('id', ticket.customer_id).single();
      if (customer) await removeEnquiryFromSheetSafely(customer.phone_number, oldDate);
    }
    await syncEnquiryToSheetSafely(ticketId);
  })().catch(() => {});

  return data;
}

// ---------------------------------------------------------------------------
// Ad-hoc service requests — a customer calling in with a problem any time,
// not tied to the 18-month yearly-service schedule (that flow is
// createServiceRequest() in warranty.ts, triggered from the computed
// due-this-month list). No parent_installation_id here deliberately —
// linking an ad-hoc repair call to an installation would corrupt the
// yearly-due cycle counting there (it counts every service_visit against
// parent_installation_id to know which cycles are already handled).
// ---------------------------------------------------------------------------

export async function createAdHocServiceRequest(input: {
  customerId: string;
  productInterest: string;
  issueNote: string;
  // Optional "Staff Attended" pick on the New Service form — an ad-hoc call
  // is usually already decided (or already done) by the time this form is
  // filled in, so picking someone here books it immediately instead of
  // making the admin repeat the same assignment step from the Requested
  // list right after. bookedDate/bookedHalfDay default to today/now on
  // the form the moment a staff member is picked, but stay editable there
  // (a visit already done yesterday, or one planned for later today) —
  // location defaults to 'home' but is a real field here too, same
  // tickets.location column every other service-visit booking uses.
  staffAttendedId?: string;
  bookedDate?: string;
  bookedHalfDay?: 'morning' | 'afternoon' | 'evening';
  location?: 'home' | 'office';
}) {
  if (!input.issueNote.trim()) throw new ApiError(400, 'A note on the reported problem is required');

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .insert({
      customer_id: input.customerId,
      kind: 'service_visit',
      status: 'open',
      enquiry_product_interest: [input.productInterest, input.issueNote].filter(Boolean).join(' — '),
      // The honest split behind that joined display string (§ split fix,
      // 2026-09-06) — issue_note is what actually tells a technician
      // what's wrong, read directly rather than reparsed out of the
      // combined field above.
      product_interest: input.productInterest || null,
      issue_note: input.issueNote,
    })
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);

  // Registered the moment it's requested, same reasoning as sales —
  // "closed" is just a status flip later, not a separate event to wait
  // for. Fire-and-forget.
  syncServiceToSheetSafely(data.id).catch(() => {});

  if (input.staffAttendedId) {
    return bookJob(data.id, {
      assignedToId: input.staffAttendedId,
      bookedDate: input.bookedDate || todayIST(),
      bookedHalfDay: input.bookedHalfDay || halfDayNowIST(),
      location: input.location ?? 'home',
    });
  }

  return data;
}

/**
 * Correcting an ad-hoc service request's own details — wrong product,
 * wrong issue note, wrong location. Only while it hasn't been visited
 * yet (`open` or `booked`) — once a technician marks it done, the visit
 * itself (parts/charge/notes) is their own §8.4 correction window, not
 * this one, and the original request details stop being the live record
 * of what's happening. Yearly Service visits aren't editable here at
 * all (`parent_installation_id` set) — their product_interest is copied
 * from the parent installation, not something typed on this ticket, and
 * they carry no issue_note to correct in the first place.
 */
export async function updateAdHocServiceRequest(
  ticketId: string,
  updates: { productInterest?: string; issueNote?: string; location?: 'home' | 'office'; requestDate?: string }
) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.kind !== 'service_visit') throw new ApiError(400, 'Not a service visit');
  if (ticket.parent_installation_id) throw new ApiError(400, 'A Yearly Service visit is not editable here');
  if (!['open', 'booked'].includes(ticket.status)) {
    throw new ApiError(400, 'This visit has already been completed — it can no longer be edited here');
  }
  if (updates.issueNote !== undefined && !updates.issueNote.trim()) {
    throw new ApiError(400, 'A note on the reported problem is required');
  }
  if (updates.requestDate && updates.requestDate > todayIST()) {
    throw new ApiError(400, 'Request date cannot be in the future');
  }

  const productInterest = updates.productInterest !== undefined ? updates.productInterest : ticket.product_interest ?? '';
  const issueNote = updates.issueNote !== undefined ? updates.issueNote : ticket.issue_note ?? '';

  const patch: Record<string, unknown> = {
    enquiry_product_interest: [productInterest, issueNote].filter(Boolean).join(' — '),
    product_interest: productInterest || null,
    issue_note: issueNote,
  };
  if (updates.location !== undefined) patch.location = updates.location;

  // date is part of the Service sheet's match key (phone_number + date)
  // — un-find the row under the old date first, same reasoning as the
  // Enquiry/Sales sheet re-key fixes.
  const oldDate = ticket.created_at.slice(0, 10);
  const dateChanging = !!(updates.requestDate && updates.requestDate !== oldDate);
  if (dateChanging) {
    patch.created_at = `${updates.requestDate}T12:00:00Z`;
  }

  const { data, error } = await supabaseAdmin.from('tickets').update(patch).eq('id', ticketId).select('*').single();
  if (error) throw new ApiError(500, error.message);

  // Fire-and-forget, remove-then-sync kept in one chained background
  // task — see updateEnquiry() above for why.
  (async () => {
    if (dateChanging) {
      const { data: customer } = await supabaseAdmin.from('customers').select('phone_number').eq('id', ticket.customer_id).single();
      if (customer) await removeServiceFromSheetSafely(customer.phone_number, oldDate);
    }
    await syncServiceToSheetSafely(ticketId);
  })().catch(() => {});

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
  action: 'pass_to_owner' | 'mark_inactive' | 'convert',
  input: { explanation?: string; linkedPurchaseNote?: string }
) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.kind !== 'enquiry') throw new ApiError(400, 'Not an enquiry');
  if (ticket.status !== 'open') throw new ApiError(400, 'Enquiry is already closed');

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

    // §2.1/§10.5: fire only after the status change above has committed.
    // Fire-and-forget — a Telegram send and a Sheets sync, neither
    // needs to block the response.
    if (action === 'pass_to_owner') {
      (async () => {
        const { data: customer } = await supabaseAdmin.from('customers').select('name').eq('id', ticket.customer_id).single();
        await notifyEnquiryPassedToOwner({ ticketId, customerName: customer?.name ?? 'Unknown', explanation });
      })().catch(() => {});
    }
    syncEnquiryToSheetSafely(ticketId).catch(() => {});

    return data;
  }

  if (action === 'convert') {
    // §5.7 (revised): "convert" no longer fires on its own — clicking
    // Convert takes the admin straight to the New Purchase form,
    // pre-filled with this customer, and createDirectPurchase() is what
    // actually creates the installation + records the price, at the
    // moment the order is genuinely placed, not just at the click.
    // This call only marks the enquiry itself as closed, once that
    // purchase has actually gone through — see
    // app/admin/installations/page.tsx's fromEnquiry handling.
    const { data: closedEnquiry, error: closeError } = await supabaseAdmin
      .from('tickets')
      .update({
        status: 'closed',
        closure_reason: 'convert',
        // Set only via "Link to Existing Purchase" — a plain New Purchase
        // conversion leaves no note, since there's nothing to explain.
        closure_explanation: input.linkedPurchaseNote ?? null,
      })
      .eq('id', ticketId)
      .select('*')
      .single();
    if (closeError) throw new ApiError(500, closeError.message);
    syncEnquiryToSheetSafely(ticketId).catch(() => {});

    return closedEnquiry;
  }

  throw new ApiError(400, 'Unknown action');
}

/**
 * A sale that never went through the call-and-convert enquiry pipeline —
 * a walk-in or already-decided customer. Produces the exact same shape of
 * open, unbooked installation ticket that closeEnquiry(..., 'convert')
 * does, so it enters the normal book → complete → confirm-and-close flow
 * from here on — no special-casing anywhere else.
 *
 * Unlike a converted enquiry, payment can already be in hand at the
 * moment of sale, so the order is created right here instead of waiting
 * for the ticket to close (closeTicketAfterConfirmation is guarded
 * against creating a second one — see below).
 *
 * One purchase can cover several products at once (e.g. a Vessel sale
 * that comes with a free Kitchen unit thrown in for inventory reasons) —
 * each item still needs its own installation ticket (a tech has to fit
 * it, warranty has to start on it) and its own order, so `items` produces
 * one ticket+order pair per line, sharing the customer and planned
 * installation date. They land in the orders table as adjacent rows.
 */
export async function createDirectPurchase(input: {
  customerId: string;
  plannedInstallationDate?: string;
  // Defaults to now (today) if not given — the till slip almost always
  // matches "now," but a sale entered a day or two after it actually
  // happened (or backdated for correction) needs to say so explicitly.
  billDate?: string;
  items: {
    productDetails: string;
    productCode?: string;
    price: number;
    paidAmount: number;
  }[];
}) {
  if (input.items.length === 0) throw new ApiError(400, 'At least one product is required');
  // Noon UTC, not midnight — a plain date-only value parsed at midnight
  // shifts a day in either direction depending on server timezone (the
  // exact bug documented in the historical-import note above).
  const billCreatedAt = input.billDate ? `${input.billDate}T12:00:00Z` : undefined;

  const results: { ticket: unknown; order: unknown }[] = [];
  for (const item of input.items) {
    if (item.price < 0) throw new ApiError(400, 'Price must be zero or more');
    if (item.paidAmount < 0) throw new ApiError(400, 'Paid amount must be zero or more');
    if (item.paidAmount > item.price) throw new ApiError(400, 'Paid amount cannot exceed the price');

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .insert({
        customer_id: input.customerId,
        kind: 'installation',
        status: 'open',
        agreed_price: item.price,
        enquiry_product_interest: item.productDetails || null,
        product_interest: item.productDetails || null,
        // Only set when ProductPicker resolved to an actual product row —
        // "Other" purchases and hand-typed extra details never have a code.
        product_code: item.productCode || null,
        planned_installation_date: input.plannedInstallationDate || null,
      })
      .select('*')
      .single();
    if (ticketError) throw new ApiError(500, ticketError.message);

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        ticket_id: ticket.id,
        list_price: item.price,
        sold_price: item.price,
        paid_amount: item.paidAmount,
        // Bill Date — order.created_at is what the Orders page and Sales
        // sheet both read as "Bill Date"; only overridden when the admin
        // explicitly picked a different one, otherwise the DB default
        // (now()) applies as before.
        ...(billCreatedAt ? { created_at: billCreatedAt } : {}),
        // Money already in hand at the moment of sale needs its own
        // payment_history entry too — otherwise only a later
        // recordPayment() call ever logs anything, and the amount paid
        // up front is invisible in the log even though it's counted in
        // paid_amount (found 2026-09-07: a real historical purchase's
        // ₹15,000 paid showed only a single later ₹5,000 entry).
        ...(item.paidAmount > 0
          ? { payment_history: [{ amount: item.paidAmount, date: billCreatedAt ?? new Date().toISOString(), recordedBy: null }] }
          : {}),
      })
      .select('*')
      .single();
    if (orderError) throw new ApiError(500, orderError.message);

    // The sale is registered the moment it's made, not when it later
    // happens to close — "closed" is just orders.status flipping once
    // balance_owed hits 0, not a separate business event. If the full
    // price is already paid at the moment of sale (or it's a free item,
    // price 0), close it right here rather than leaving it sitting
    // "open" forever waiting on a manual click — recordPayment() already
    // does exactly this when a later payment finishes the balance off;
    // this was the one gap where it didn't happen (found 2026-09-08: a
    // real ₹17,000 purchase paid in full at sale time stayed "open" with
    // balance_owed 0 indefinitely, which "Payments outstanding" then
    // read as still owing money).
    let finalOrder = order;
    if (item.paidAmount >= item.price) {
      finalOrder = await closeOrder(order.id);
    } else {
      // Fire-and-forget.
      syncOrderToSalesSheetSafely(order.id).catch(() => {});
    }
    if (item.paidAmount > 0) {
      logTicketPaymentToSheetSafely({
        ticketId: ticket.id,
        channel: 'Purchase',
        amount: item.paidAmount,
        date: billCreatedAt ?? new Date().toISOString(),
      }).catch(() => {});
    }

    results.push({ ticket, order: finalOrder });
  }

  return results;
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
    .select('*, customers(name, address)')
    .single();

  if (error) throw new ApiError(500, error.message);

  // §10.5: fire only after the booking above has already committed —
  // a Telegram failure here can never undo or block the assignment.
  // Fire-and-forget — a Telegram send shouldn't hold up the response.
  (async () => {
    const { data: technician } = await supabaseAdmin.from('users').select('name').eq('id', input.assignedToId).single();
    const product = data.product_interest || data.enquiry_product_interest;
    const kindLabel = data.kind === 'service_visit' ? 'Yearly service visit' : 'Installation';
    await notifyJobAssigned({
      ticketId,
      productOrKind: product ? `${product} — ${kindLabel}` : kindLabel,
      bookedDate: input.bookedDate,
      bookedHalfDay: input.bookedHalfDay,
      location: input.location,
      customerName: data.customers.name,
      customerAddress: data.customers.address,
      technicianName: technician?.name ?? 'Unknown',
      // Only ever set on an ad-hoc Service Call (§ Root Cause Fix:
      // product_interest/issue_note split) — the only place a technician
      // ever saw this was a box on /staff/jobs, so once that page is gone
      // this Telegram message is the only place it survives at all.
      issueNote: data.issue_note ?? null,
    });
  })().catch(() => {});

  return data;
}

/**
 * §6.5/§6.6: what actually happened, recorded by an admin from the
 * dashboard's "Finished Installation/Service" card once the technician
 * reports back (by phone/Telegram) that a job is done — there's no
 * technician login to record it themselves. `callerId` is always the
 * ticket's own `assigned_to_id`, not the admin's own id, so the ownership
 * check below stays meaningful and `notifyJobCompleted()` still names the
 * real technician. Always stamps *today* as `actual_date` (no backdating)
 * — see CLAUDE.md's staff-portal-removal note for the accepted tradeoff.
 * Spare parts sold go through `recordSparePartSale()` instead (linked by
 * `ticket_id`), not through this ticket's own row — see the same note.
 */
export async function completeJob(
  ticketId: string,
  callerId: string,
  input: {
    actualDate: string;
    notes: string;
  }
) {
  const ticket = await getTicketOrThrow(ticketId);

  if (ticket.assigned_to_id !== callerId) {
    throw new ApiError(403, 'This job is not assigned to that technician');
  }
  if (ticket.status !== 'booked') {
    throw new ApiError(400, 'Job is not in a bookable-to-complete state');
  }
  // A service visit can't be marked done until the admin has gone through
  // the spare-parts step for it — either recording real parts (Sell Spare
  // Part, which sets this itself) or explicitly saying none were needed
  // (confirmNoSparesNeeded()). Doesn't apply to an installation, which
  // has no spare-parts step of its own.
  if (ticket.kind === 'service_visit' && !ticket.spares_confirmed) {
    throw new ApiError(400, 'Record spare parts (or confirm none were needed) before marking this visit done');
  }

  const update: Record<string, unknown> = {
    actual_date: input.actualDate,
    actual_notes: input.notes,
    status: 'completed', // §6.7: completed, not closed — returns to admin
  };

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update(update)
    .eq('id', ticketId)
    .select(
      // §13.4: never a selling price in this response. `agreed_price` (the
      // order's sale price) is deliberately excluded even though it lives
      // on this same row — this response shape predates staff login and
      // is kept exactly as strict now that only admin/owner call it.
      'id, kind, status, actual_date, actual_notes'
    )
    .single();
  if (error) throw new ApiError(500, error.message);

  // §10.5: after the write above has committed. Fire-and-forget — a
  // Telegram send shouldn't hold up the response.
  (async () => {
    const [{ data: customer }, { data: technician }] = await Promise.all([
      supabaseAdmin.from('customers').select('name, address').eq('id', ticket.customer_id).single(),
      supabaseAdmin.from('users').select('name').eq('id', callerId).single(),
    ]);
    const product = ticket.product_interest || ticket.enquiry_product_interest;
    const kindLabel = ticket.kind === 'service_visit' ? 'a service visit' : 'an installation';
    await notifyJobCompleted({
      ticketId,
      technicianName: technician?.name ?? 'Unknown',
      productOrKind: product ? `${product} (${kindLabel})` : kindLabel,
      customerName: customer?.name ?? 'Unknown',
      customerAddress: customer?.address ?? 'Unknown',
    });
  })().catch(() => {});

  return data;
}

/**
 * Correcting a mistake in what was recorded when a job was marked done —
 * the completion date or notes — for a job that's already `completed` or
 * `closed`. Direct replacement for the old (removed) technician-facing
 * `editCompletedServiceVisit()`: same idea (a mistake-fix window after the
 * fact), now an admin action reachable from Purchases/Services instead of
 * a technician's own screen.
 *
 * An already-closed installation had its warranty clock started from the
 * old `actual_date` (§8.1, in `closeTicketAfterConfirmation`) — correcting
 * the date re-derives `installation_date`/`warranty_expires_at` from the
 * new one too, so a correction can't leave the warranty window pointing at
 * a date nobody actually confirmed any more. Neither sheet's match key
 * (Sales: phone+bill_date+sold_price; Service: phone+date=created_at)
 * includes `actual_date`, so a plain re-sync finds and updates the
 * existing row in place — no clear-then-write dance needed here, unlike a
 * bill_date/sold_price edit.
 */
export async function editCompletedJob(
  ticketId: string,
  editorId: string,
  input: { actualDate: string; notes: string; assignedToId?: string }
) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.status !== 'completed' && ticket.status !== 'closed') {
    throw new ApiError(400, 'Job must be marked done before its record can be corrected');
  }
  if (input.actualDate > todayIST()) {
    throw new ApiError(400, 'Completion date cannot be in the future');
  }

  const editHistory = Array.isArray(ticket.edit_history) ? ticket.edit_history : [];
  const entry = {
    before: { actual_date: ticket.actual_date, actual_notes: ticket.actual_notes, assigned_to_id: ticket.assigned_to_id },
    editedBy: editorId,
    editedAt: new Date().toISOString(),
  };

  const update: Record<string, unknown> = {
    actual_date: input.actualDate,
    actual_notes: input.notes,
    edit_history: [...editHistory, entry],
  };
  // Correcting who actually did the job — e.g. it was really Yasir, not
  // Cristeen, and the wrong person got booked/recorded at the time. Never
  // clears it to unassigned; the DB's own §13.5 trigger
  // (check_assignee_is_service_staff) independently refuses this if given
  // anything but a real, active service_staff id, the same guard every
  // other assignment in this app already goes through.
  if (input.assignedToId) {
    update.assigned_to_id = input.assignedToId;
  }

  if (ticket.kind === 'installation' && ticket.status === 'closed') {
    const warrantyExpires = new Date(input.actualDate);
    warrantyExpires.setFullYear(warrantyExpires.getFullYear() + 1);
    update.installation_date = input.actualDate;
    update.warranty_expires_at = warrantyExpires.toISOString().slice(0, 10);
  }

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update(update)
    .eq('id', ticketId)
    .select('id, kind, status, actual_date, actual_notes')
    .single();
  if (error) throw new ApiError(500, error.message);

  if (ticket.kind === 'installation') {
    (async () => {
      const { data: order } = await supabaseAdmin.from('orders').select('id').eq('ticket_id', ticketId).maybeSingle();
      if (order) await syncOrderToSalesSheetSafely(order.id);
    })().catch(() => {});
  } else {
    syncServiceToSheetSafely(ticketId).catch(() => {});
  }

  return data;
}

/**
 * "Put back to dispatch" — undoes a booking entirely (not a cancellation:
 * the customer still needs the work done, it's just nobody's assigned to
 * it right now). Clears assignment/schedule back to exactly the shape a
 * freshly-created ticket has, so it reappears in Jobs to Dispatch the
 * same way an unbooked one would.
 */
export async function unassignJob(ticketId: string) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.status !== 'booked') throw new ApiError(400, 'Job is not currently booked');

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update({ status: 'open', assigned_to_id: null, booked_date: null, booked_half_day: null, location: null })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  return data;
}

/**
 * §6.8: cancelling a job requires a reason. For an installation this
 * doubles as "void a wrong purchase" (wrong customer, wrong product) —
 * the ticket alone isn't the whole record of a purchase, so cancelling
 * it also deletes its order and un-writes the Sales sheet row, rather
 * than leaving a stray order sitting around still counting toward
 * revenue/balance-owed everywhere those are read straight off the
 * `orders` table with no status filter.
 *
 * Refuses once a technician has actually recorded a visit (`actual_date`
 * set) — at that point there's real work done, not a data-entry mistake
 * to undo — and refuses an installation with any payment already
 * recorded, since undoing money that's actually changed hands needs a
 * human decision (a refund, an adjustment), not a delete.
 */
export async function cancelJob(ticketId: string, reason: string) {
  if (!reason.trim()) throw new ApiError(400, 'A cancellation reason is required');
  const ticket = await getTicketOrThrow(ticketId);

  if (ticket.kind === 'enquiry') throw new ApiError(400, 'An enquiry is closed via its own actions, not this');
  if (ticket.status === 'inactive') throw new ApiError(400, 'This is already cancelled');
  if (ticket.actual_date) {
    throw new ApiError(400, 'A visit has already been recorded — this can no longer be cancelled here');
  }

  if (ticket.kind === 'installation') {
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, paid_amount')
      .eq('ticket_id', ticketId)
      .maybeSingle();
    if (orderError) throw new ApiError(500, orderError.message);

    if (order) {
      if (Number(order.paid_amount) > 0) {
        throw new ApiError(400, 'A payment has already been recorded against this purchase — it cannot be cancelled here');
      }
      // Before the delete below — needs the order's own data to find its
      // Sales-sheet row by the same phone_number/bill_date/sold_price key.
      await removeOrderFromSalesSheetSafely(order.id);
      const { error: deleteError } = await supabaseAdmin.from('orders').delete().eq('id', order.id);
      if (deleteError) throw new ApiError(500, deleteError.message);
    }
  }

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
 * Correcting a purchase's product or price — available at any stage of
 * its life, not just before a visit (revised 2026-09-15 — an already-
 * completed or closed purchase had no way to fix a typo except the much
 * narrower completion-date/notes edit, which doesn't touch product or
 * money at all). A payment already in hand only puts a floor under
 * sold_price — it can never drop below what's already been paid.
 *
 * Raising sold_price above what's already been paid, on an order that
 * was closed, *reopens* it — a real balance now exists, so the order
 * has to go back to showing up in Payments Outstanding rather than
 * quietly reading "closed" with money owed (the DB's own
 * enforce_order_payment_on_close trigger would refuse the write outright
 * otherwise). Symmetrically, lowering sold_price down to what's already
 * paid closes an order that was still open — the same "closing isn't a
 * separate action, just balance hitting zero" rule recordPayment()
 * already applies. Both directions are intentional, not a side effect
 * to guard against — a genuine price correction should genuinely change
 * whether money is still owed.
 *
 * The customer itself still isn't editable here at all; a wrong-customer
 * purchase goes through Void instead (still gated to unpaid+unvisited —
 * a genuine data-entry mistake, not a real sale), since re-pointing
 * customer_id has bigger implications (duplicate warnings, the Sales
 * sheet's phone-based match key) than a product/price typo does.
 */
export async function updatePurchase(
  ticketId: string,
  updates: { productCode?: string | null; productDetails?: string; listPrice?: number; soldPrice?: number; billDate?: string }
) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.kind !== 'installation') throw new ApiError(400, 'Not a purchase');

  const { data: order, error: orderError } = await supabaseAdmin.from('orders').select('*').eq('ticket_id', ticketId).single();
  if (orderError || !order) throw new ApiError(404, 'Order not found for this purchase');
  if (updates.listPrice !== undefined && updates.listPrice < 0) throw new ApiError(400, 'List price must be zero or more');
  if (updates.soldPrice !== undefined && updates.soldPrice < 0) throw new ApiError(400, 'Sold price must be zero or more');
  // The sold price can never drop below what's already been paid —
  // that would imply a negative balance owed, which the orders table's
  // own CHECK constraint (paid_amount <= sold_price) would refuse anyway.
  if (updates.soldPrice !== undefined && updates.soldPrice < Number(order.paid_amount)) {
    throw new ApiError(400, `Sold price cannot be less than the ₹${order.paid_amount} already paid`);
  }
  if (updates.billDate && updates.billDate > todayIST()) throw new ApiError(400, 'Bill date cannot be in the future');

  // sold_price *and* bill_date are both part of the Sales sheet's match
  // key (phone_number + bill_date + sold_price) — clear the old row
  // first, while it's still findable under the values about to change,
  // so the fresh sync below doesn't leave a stale duplicate sitting next
  // to the corrected row.
  const billDate = updates.billDate ? `${updates.billDate}T12:00:00Z` : undefined;
  const keyChanging =
    (updates.soldPrice !== undefined && updates.soldPrice !== Number(order.sold_price)) ||
    (billDate !== undefined && billDate.slice(0, 10) !== order.created_at.slice(0, 10));
  if (keyChanging) {
    await removeOrderFromSalesSheetSafely(order.id);
  }

  const ticketPatch: Record<string, unknown> = {};
  if (updates.productCode !== undefined) ticketPatch.product_code = updates.productCode || null;
  if (updates.productDetails !== undefined) {
    ticketPatch.enquiry_product_interest = updates.productDetails || null;
    ticketPatch.product_interest = updates.productDetails || null;
  }
  if (updates.soldPrice !== undefined) ticketPatch.agreed_price = updates.soldPrice;
  if (Object.keys(ticketPatch).length > 0) {
    const { error } = await supabaseAdmin.from('tickets').update(ticketPatch).eq('id', ticketId);
    if (error) throw new ApiError(500, error.message);
  }

  const orderPatch: Record<string, unknown> = {};
  if (updates.listPrice !== undefined) orderPatch.list_price = updates.listPrice;
  if (updates.soldPrice !== undefined) {
    orderPatch.sold_price = updates.soldPrice;
    // Recompute open/closed together with sold_price in the same write —
    // the DB trigger checks NEW.status against the balance implied by
    // NEW.sold_price, so status has to travel with it in one statement
    // rather than a follow-up call (which the trigger would reject
    // outright if it left a closed order showing a balance owed).
    const newBalance = updates.soldPrice - Number(order.paid_amount);
    orderPatch.status = newBalance > 0 ? 'open' : 'closed';
  }
  if (billDate !== undefined) orderPatch.created_at = billDate;

  let updatedOrder = order;
  if (Object.keys(orderPatch).length > 0) {
    const { data, error } = await supabaseAdmin.from('orders').update(orderPatch).eq('id', order.id).select('*').single();
    if (error) throw new ApiError(500, error.message);
    updatedOrder = data;
  }

  // Fire-and-forget — safe here since the order row above has already
  // been fully patched, so this sync reads already-correct values.
  // Unlike this, removeOrderFromSalesSheetSafely() above stays awaited:
  // it depends on reading the order's *old* (about to change) values
  // before this patch overwrites them — backgrounding it could race
  // against the patch and read the new values instead, reintroducing
  // the exact duplicate-row bug this whole mechanism exists to prevent.
  syncOrderToSalesSheetSafely(order.id).catch(() => {});
  return updatedOrder;
}

/**
 * "Others" (New Purchase's "Assign to Staff" option, was labeled "No
 * staff — I did it myself"): the admin or owner personally installed
 * the unit at the moment of sale, so there's nothing to dispatch — no
 * technician, no booking, no separate completion step later. Skips
 * straight from a freshly-created, still-`open` installation ticket to
 * `completed` (with the given date) and hands off to
 * `closeTicketAfterConfirmation()` for the actual warranty/order logic,
 * exactly as if a technician had been assigned, visited, and been
 * confirmed — there's just no technician in this picture at all, so
 * `assigned_to_id` stays null throughout (§13.5's assignee rule only
 * ever applies to a real assignment, which this deliberately isn't one).
 */
export async function selfCompleteInstallation(ticketId: string, actualDate: string) {
  const ticket = await getTicketOrThrow(ticketId);
  if (ticket.kind !== 'installation') throw new ApiError(400, 'Only an installation can be self-completed');
  if (ticket.status !== 'open') throw new ApiError(400, 'Job is already assigned or completed');
  if (actualDate > todayIST()) throw new ApiError(400, 'Completion date cannot be in the future');

  const { error } = await supabaseAdmin
    .from('tickets')
    .update({ actual_date: actualDate, status: 'completed' })
    .eq('id', ticketId);
  if (error) throw new ApiError(500, error.message);

  return closeTicketAfterConfirmation(ticketId);
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
    // A direct purchase (createDirectPurchase) already created the order
    // up front, at the moment of sale — don't create a second one now that
    // it's going through the normal book → complete → close path.
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('ticket_id', ticketId)
      .maybeSingle();
    if (existingOrder) {
      // installation_date/warranty_expires_at were just stamped above —
      // the sale's sheet row already exists (from createDirectPurchase),
      // this just updates those two columns on it. Fire-and-forget.
      syncOrderToSalesSheetSafely(existingOrder.id).catch(() => {});
      return { ticket: closed, order: existingOrder };
    }

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
    syncOrderToSalesSheetSafely(order.id).catch(() => {});
    return { ticket: closed, order };
  }

  if (ticket.kind === 'service_visit') {
    syncServiceToSheetSafely(ticketId).catch(() => {});
  }

  return { ticket: closed, order: null };
}
