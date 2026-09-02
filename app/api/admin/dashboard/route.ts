import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { daysAgoIST, todayIST } from '@/lib/dates';
import { getYearlyServiceDueThisMonth } from '@/lib/services/warranty';

// installation_date is a plain DATE (no time/timezone component) — doing
// calendar-day subtraction directly on the date string avoids the
// timestamptz-threshold helpers built for created_at-style columns.
function dateMinusDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * §15.1: everyone the admin needs to call today, on one screen — new
 * enquiries, jobs waiting to be dispatched to a technician, customers to
 * confirm finished work with, payments outstanding, yearly service calls
 * due. One query per category, all fired together; no page-to-page
 * navigating required to see all five.
 */
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);
    const today = todayIST();

    const [newEnquiries, jobsToDispatch, awaitingConfirmation, paymentsOutstanding, satisfactionCallsDue] = await Promise.all([
      // §5: open enquiries, oldest first so 14+ day ones are already at the top (§5.6/§15.4).
      supabaseAdmin
        .from('tickets')
        .select('id, created_at, enquiry_product_interest, customers(name, phone_number)')
        .eq('kind', 'enquiry')
        .eq('status', 'open')
        .order('created_at', { ascending: true }),

      // Installations and service visits that exist but haven't been
      // assigned to a technician yet — an installation the moment a New
      // Purchase is made, or a service_visit still 'open' (yearly-due or
      // ad-hoc, whichever wasn't booked immediately via Staff Attended).
      // Oldest-first — the ones waiting longest need dispatching first.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, created_at, enquiry_product_interest, customers(name, phone_number)')
        .in('kind', ['installation', 'service_visit'])
        .eq('status', 'open')
        .order('created_at', { ascending: true }),

      // §6.7: completed jobs waiting on the admin's confirmation call.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, actual_date, customers(name, phone_number)')
        .in('kind', ['installation', 'service_visit'])
        .eq('status', 'completed')
        .order('actual_date', { ascending: true }),

      // §7.3/§7.6/§15.6: every order still owed, with discount visible.
      supabaseAdmin
        .from('orders')
        .select('id, sold_price, discount, balance_owed, last_payment_call_at, tickets(customers(name, phone_number))')
        .eq('status', 'open')
        .order('balance_owed', { ascending: false }),

      // Follow-up satisfaction call, separate from the install-confirm
      // step — due for anything installed in the last 30 days that
      // hasn't had this specific call logged yet.
      supabaseAdmin
        .from('orders')
        .select('id, tickets!inner(installation_date, customers(name, phone_number))')
        .eq('confirmation_status', 'pending')
        .not('tickets.installation_date', 'is', null)
        .gte('tickets.installation_date', dateMinusDays(today, 30)),
    ]);

    // Plain read-time computation, not a DB query — see
    // getYearlyServiceDueThisMonth() for the "due this calendar month" rule.
    const serviceCallsDue = await getYearlyServiceDueThisMonth();

    const oldEnquiryCount = (newEnquiries.data ?? []).filter((e) => daysAgoIST(e.created_at) >= 14).length;

    // A job still waiting to be assigned after 3 days is worth flagging the
    // same way an overdue payment call or enquiry is elsewhere on this page.
    const overdueDispatchCount = (jobsToDispatch.data ?? []).filter((t) => daysAgoIST(t.created_at) >= 3).length;

    const overdueCallCount = (paymentsOutstanding.data ?? []).filter((o) => {
      const days = o.last_payment_call_at ? daysAgoIST(o.last_payment_call_at) : Infinity;
      return days >= 3;
    }).length;

    // One row per customer, not per order — the same customer can have
    // more than one order outstanding, and "who owes what" is a
    // per-person question, not a per-order one (matches the owner
    // dashboard's overdue-by-person list).
    const owedByCustomer = new Map<string, { name: string; phoneNumber: string; totalBalance: number; orderCount: number }>();
    for (const o of paymentsOutstanding.data ?? []) {
      const customer = (o.tickets as unknown as { customers: { name: string; phone_number: string } }).customers;
      const key = customer.phone_number;
      const existing = owedByCustomer.get(key);
      if (existing) {
        existing.totalBalance += Number(o.balance_owed);
        existing.orderCount += 1;
      } else {
        owedByCustomer.set(key, { name: customer.name, phoneNumber: key, totalBalance: Number(o.balance_owed), orderCount: 1 });
      }
    }
    const paymentsOutstandingByPerson = [...owedByCustomer.values()].sort((a, b) => b.totalBalance - a.totalBalance);

    // A completed job sitting unconfirmed for a week is a customer who
    // finished the work days ago and nobody's called to close the loop.
    const overdueConfirmationCount = (awaitingConfirmation.data ?? []).filter(
      (t) => t.actual_date && daysAgoIST(t.actual_date) >= 7
    ).length;

    const satisfactionCallsDueList = (satisfactionCallsDue.data ?? [])
      .map((o: any) => ({
        orderId: o.id,
        installationDate: o.tickets.installation_date as string,
        customers: o.tickets.customers,
      }))
      .sort((a, b) => a.installationDate.localeCompare(b.installationDate));

    return Response.json({
      newEnquiries: newEnquiries.data ?? [],
      oldEnquiryCount,
      jobsToDispatch: jobsToDispatch.data ?? [],
      overdueDispatchCount,
      awaitingConfirmation: awaitingConfirmation.data ?? [],
      overdueConfirmationCount,
      serviceCallsDue,
      paymentsOutstanding: paymentsOutstandingByPerson,
      overdueCallCount,
      satisfactionCallsDue: satisfactionCallsDueList,
      today,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
