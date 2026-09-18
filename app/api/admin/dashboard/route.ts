import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { daysAgoIST, isEnquiryOverdue, todayIST, mondaySaturdayWeekIST } from '@/lib/dates';
import { getYearlyServiceDueThisMonth } from '@/lib/services/warranty';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

/**
 * §15.1: everyone the admin needs to call today, on one screen — new
 * enquiries, jobs waiting to be dispatched to a technician, jobs overdue
 * to be marked done, payments outstanding, yearly service calls due. One
 * query per category, all fired together; no page-to-page navigating
 * required to see all of it. No separate "confirm finished work" step any
 * more — marking a job done now closes it in the same action (see
 * completeJob()/closeTicketAfterConfirmation() in lib/services/tickets.ts).
 */
export async function GET() {
  try {
    // 'developer' included so the Developer panel's "View As Admin" preview works.
    await requireUser(['admin', 'owner', 'developer']);
    const today = todayIST();
    // Fixed Mon–Sat calendar week — matches the owner dashboard's own
    // identical query (mondaySaturdayWeekIST()). Was briefly a rolling
    // "today + 2 working days" window; reverted back to the full week at
    // direct request.
    const scheduleDays = mondaySaturdayWeekIST();
    const weekStart = scheduleDays[0];
    const weekEnd = scheduleDays[scheduleDays.length - 1];

    const [newEnquiries, jobsToDispatch, dueForMarkDone, paymentsOutstanding, weekJobs] = await Promise.all([
      // §5: open enquiries, oldest first so 14+ day ones are already at the top (§5.6/§15.4).
      supabaseAdmin
        .from('tickets')
        .select('id, created_at, last_call_at, enquiry_product_interest, customers(name, phone_number)')
        .eq('kind', 'enquiry')
        .eq('status', 'open')
        .order('created_at', { ascending: true }),

      // Both New Service requests and New Purchases (installations) that
      // exist but haven't been assigned to anyone yet — 'open' means
      // exactly that, whether it's a fresh installation or a service_visit
      // (yearly-due or ad-hoc). Once it's booked to a tech it's no longer
      // "to dispatch" — it's in progress, tracked wherever that job kind
      // normally lives. Oldest-first — whatever's been waiting longest
      // needs dispatching first.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, created_at, enquiry_product_interest, customers(name, phone_number, area)')
        .in('kind', ['installation', 'service_visit'])
        .eq('status', 'open')
        .order('created_at', { ascending: true }),

      // Booked jobs due (or overdue) to be marked done — there's no
      // technician login to do this themselves any more; the tech reports
      // back over Telegram/phone and admin records it here (part 1 of the
      // "Finished Installation/Service" card). A job booked for a future
      // date doesn't belong here yet.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, booked_date, spares_confirmed, customers(name, phone_number)')
        .in('kind', ['installation', 'service_visit'])
        .eq('status', 'booked')
        .lte('booked_date', today)
        .order('booked_date', { ascending: true }),

      // §7.3/§7.6/§15.6: every order still owed, with discount visible.
      // installation_date lets the card show how long ago the unit was
      // actually fitted, alongside the balance — a much older unpaid
      // installation reads as more urgent than a fresh one. balance_owed
      // > 0 is the actual "still owed" test — status alone isn't enough:
      // an order paid in full at the moment of sale is supposed to close
      // itself immediately (createDirectPurchase()), but this is a second,
      // independent check so a $0-balance order can never show up here
      // as "owed" even if something upstream ever left it open again.
      supabaseAdmin
        .from('orders')
        .select('id, sold_price, discount, balance_owed, last_payment_call_at, tickets(installation_date, customers(name, phone_number))')
        .eq('status', 'open')
        .gt('balance_owed', 0)
        .order('balance_owed', { ascending: false }),

      // Staff schedule — today plus the next couple of working days. status
      // included so the frontend only offers to edit a still-'booked' job.
      // Includes 'closed' alongside 'booked'/'completed' — a job finished
      // and closed earlier the same day (which, since the mark-done/close
      // merge, is nearly instant) still represents real work that
      // happened this week and should keep showing here, not vanish the
      // moment it's confirmed. Only 'inactive' (voided) drops off.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, status, booked_date, booked_half_day, location, assigned_to_id, customers(name)')
        .in('kind', ['installation', 'service_visit'])
        .gte('booked_date', weekStart)
        .lte('booked_date', weekEnd)
        .in('status', ['booked', 'completed', 'closed']),
    ]);

    // Plain read-time computation, not a DB query — see
    // getYearlyServiceDueThisMonth() for the "due this calendar month" rule.
    const serviceCallsDue = await getYearlyServiceDueThisMonth();

    const oldEnquiryCount = (newEnquiries.data ?? []).filter((e) => isEnquiryOverdue(e.created_at, e.last_call_at)).length;

    // A job still waiting to be assigned after 3 days is worth flagging the
    // same way an overdue payment call or enquiry is elsewhere on this page.
    const overdueDispatchCount = (jobsToDispatch.data ?? []).filter((t) => daysAgoIST(t.created_at) >= 3).length;

    // A booked job still not marked done 3+ days after its own booked
    // date is worth flagging the same way — same threshold as dispatch.
    const overdueMarkDoneCount = (dueForMarkDone.data ?? []).filter((t) => daysAgoIST(t.booked_date) >= 3).length;

    const overdueCallCount = (paymentsOutstanding.data ?? []).filter((o) => {
      const days = o.last_payment_call_at ? daysAgoIST(o.last_payment_call_at) : Infinity;
      return days >= 3;
    }).length;

    // One row per customer, not per order — the same customer can have
    // more than one order outstanding, and "who owes what" is a
    // per-person question, not a per-order one (matches the owner
    // dashboard's overdue-by-person list).
    const owedByCustomer = new Map<
      string,
      { name: string; phoneNumber: string; totalBalance: number; orderCount: number; oldestInstallationDate: string | null }
    >();
    for (const o of paymentsOutstanding.data ?? []) {
      const ticket = o.tickets as unknown as { installation_date: string | null; customers: { name: string; phone_number: string } };
      const customer = ticket.customers;
      const key = customer.phone_number;
      const existing = owedByCustomer.get(key);
      if (existing) {
        existing.totalBalance += Number(o.balance_owed);
        existing.orderCount += 1;
        // Oldest (not most recent) — the longest-installed still-unpaid
        // unit is the one that's been outstanding longest.
        if (ticket.installation_date && (!existing.oldestInstallationDate || ticket.installation_date < existing.oldestInstallationDate)) {
          existing.oldestInstallationDate = ticket.installation_date;
        }
      } else {
        owedByCustomer.set(key, {
          name: customer.name,
          phoneNumber: key,
          totalBalance: Number(o.balance_owed),
          orderCount: 1,
          oldestInstallationDate: ticket.installation_date,
        });
      }
    }
    const paymentsOutstandingByPerson = [...owedByCustomer.values()].sort((a, b) => b.totalBalance - a.totalBalance);

    return Response.json({
      newEnquiries: newEnquiries.data ?? [],
      oldEnquiryCount,
      jobsToDispatch: jobsToDispatch.data ?? [],
      overdueDispatchCount,
      dueForMarkDone: dueForMarkDone.data ?? [],
      overdueMarkDoneCount,
      serviceCallsDue,
      paymentsOutstanding: paymentsOutstandingByPerson,
      overdueCallCount,
      weekJobs: weekJobs.data ?? [],
      scheduleDays,
      today,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
