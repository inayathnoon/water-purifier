import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

/**
 * §15.3: an owner should be able to answer three questions without asking
 * anyone — what's happening today, what did we earn this month, and who's
 * busy. §7.6: discounts belong here too, since margin sits between list
 * and sold price.
 */
export async function GET() {
  try {
    await requireUser(['owner']);

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartISO = monthStart.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const [todaysJobs, monthOrders, pendingLeave, passedToOwner, overdueOrders, commercialVesselEnquiries] = await Promise.all([
      // What's happening today — every job booked for today, by technician.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, booked_half_day, users:assigned_to_id(name), customers(name)')
        .in('kind', ['installation', 'service_visit'])
        .eq('booked_date', today)
        .in('status', ['booked', 'completed']),

      // What did we earn this month — orders created (i.e. sale closed) this month.
      supabaseAdmin.from('orders').select('sold_price, discount, paid_amount').gte('created_at', monthStartISO),

      supabaseAdmin.from('leave_requests').select('id, requester_id, start_date, end_date, users:requester_id(name)').eq('status', 'pending'),

      // §2.1: enquiries the admin couldn't close, needing the owner's attention.
      supabaseAdmin
        .from('tickets')
        .select('id, closure_explanation, customers(name, phone_number)')
        .eq('kind', 'enquiry')
        .eq('status', 'passed_to_owner'),

      // §7.4: still outstanding after 7 days — the owner is told.
      supabaseAdmin
        .from('orders')
        .select('id, balance_owed, created_at, tickets(customers(name, phone_number))')
        .eq('status', 'open')
        .lte('created_at', sevenDaysAgo),

      // Commercial/Vessel enquiries are automatically flagged for the
      // owner's eye — a bigger sale than a routine kitchen unit, worth
      // knowing about even before the admin decides it needs passing up.
      supabaseAdmin
        .from('tickets')
        .select('id, created_at, enquiry_product_interest, customers(name, phone_number)')
        .eq('kind', 'enquiry')
        .eq('status', 'open')
        .in('enquiry_product_interest', ['Vessel', 'Commercial']),
    ]);

    const whoIsBusy: Record<string, number> = {};
    for (const job of todaysJobs.data ?? []) {
      const name = (job.users as unknown as { name: string } | null)?.name ?? 'Unassigned';
      whoIsBusy[name] = (whoIsBusy[name] ?? 0) + 1;
    }

    const monthRevenue = (monthOrders.data ?? []).reduce(
      (acc, o) => ({
        sold: acc.sold + Number(o.sold_price),
        discount: acc.discount + Number(o.discount),
        collected: acc.collected + Number(o.paid_amount),
      }),
      { sold: 0, discount: 0, collected: 0 }
    );

    return Response.json({
      todaysJobs: todaysJobs.data ?? [],
      whoIsBusy,
      monthRevenue,
      pendingLeaveCount: pendingLeave.data?.length ?? 0,
      passedToOwner: passedToOwner.data ?? [],
      overdueOrders: overdueOrders.data ?? [],
      commercialVesselEnquiries: commercialVesselEnquiries.data ?? [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
