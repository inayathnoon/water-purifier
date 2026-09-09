import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { todayIST, monthStartISTThreshold } from '@/lib/dates';

// §15.3's "what did we earn this month" split out by category — the three
// product categories (from the sold purifier itself), spare parts (both
// an office walk-in sale and whatever a tech sold during a visit), and
// the flat service-charge line, so a category with zero this month
// doesn't just vanish from the object.
const CATEGORY_KEYS = ['KITCHEN', 'VESSEL', 'COMMERCIAL'] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

// Same check used everywhere else a spare-parts price list can include the
// flat "Service charges" line (whatever case/pluralization the sheet uses).
function isServiceChargeRow(partName: string): boolean {
  return partName.trim().toLowerCase().startsWith('service charge');
}

// booked_date is a plain DATE column — string arithmetic avoids the
// timestamptz-threshold helpers built for created_at-style columns.
function dateAddDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * §15.3: an owner should be able to answer three questions without asking
 * anyone — what's happening today, what did we earn this month, and who's
 * busy. §7.6: discounts belong here too, since margin sits between list
 * and sold price. Also: this week's schedule per technician, jobs still
 * needing dispatch (owner can assign directly, same as admin), and every
 * outstanding payment (not just the 7+ day ones) with when it was last
 * called about.
 */
export async function GET() {
  try {
    // 'developer' included so the Developer panel's "View As Owner" preview works.
    await requireUser(['owner', 'developer']);

    const today = todayIST();
    const weekEnd = dateAddDays(today, 6);
    const monthStartISO = monthStartISTThreshold();

    const [
      todaysJobs,
      monthOrders,
      pendingLeave,
      passedToOwner,
      paymentsOutstanding,
      commercialVesselEnquiries,
      weekJobs,
      jobsToDispatch,
      monthSparePartSales,
    ] = await Promise.all([
      // What's happening today — every job booked for today, by technician.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, booked_half_day, users:assigned_to_id(name), customers(name)')
        .in('kind', ['installation', 'service_visit'])
        .eq('booked_date', today)
        .in('status', ['booked', 'completed']),

      // What did we earn this month — orders created (i.e. sale closed) this
      // month. products(category) comes along via tickets.product_code, for
      // the by-category revenue split below (null for a hand-typed/historical
      // order with no linked product row).
      supabaseAdmin
        .from('orders')
        .select('sold_price, discount, paid_amount, tickets(products(category))')
        .gte('created_at', monthStartISO),

      supabaseAdmin.from('leave_requests').select('id, requester_id, start_date, end_date, users:requester_id(name)').eq('status', 'pending'),

      // §2.1: enquiries the admin couldn't close, needing the owner's attention.
      supabaseAdmin
        .from('tickets')
        .select('id, closure_explanation, customers(name, phone_number)')
        .eq('kind', 'enquiry')
        .eq('status', 'passed_to_owner'),

      // §7.3/§7.6: every order still owed — same list admin sees, not just
      // the 7+ day ones — so the owner can check on any of it directly.
      // balance_owed > 0 is the real "still owed" test, same reasoning as
      // the admin dashboard's identical query.
      supabaseAdmin
        .from('orders')
        .select('id, balance_owed, created_at, last_payment_call_at, tickets(customers(name, phone_number))')
        .eq('status', 'open')
        .gt('balance_owed', 0),

      // Commercial/Vessel enquiries are automatically flagged for the
      // owner's eye — a bigger sale than a routine kitchen unit, worth
      // knowing about even before the admin decides it needs passing up.
      supabaseAdmin
        .from('tickets')
        .select('id, created_at, enquiry_product_interest, customers(name, phone_number)')
        .eq('kind', 'enquiry')
        .eq('status', 'open')
        .in('enquiry_product_interest', ['Vessel', 'Commercial']),

      // This week's schedule, per technician — what's lined up for them
      // (§15.3's "who's busy" taken out to a full week, not just today).
      supabaseAdmin
        .from('tickets')
        .select('id, kind, booked_date, booked_half_day, assigned_to_id, customers(name)')
        .in('kind', ['installation', 'service_visit'])
        .gte('booked_date', today)
        .lte('booked_date', weekEnd)
        .in('status', ['booked', 'completed']),

      // Same "needs a technician" list as the admin dashboard's Jobs to
      // Dispatch — shown alongside the week's schedule so the owner sees
      // the full picture (who's busy + what's still unassigned) in one
      // place, and can assign directly from here too.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, created_at, enquiry_product_interest, customers(name, phone_number)')
        .in('kind', ['installation', 'service_visit'])
        .eq('status', 'open')
        .order('created_at', { ascending: true }),

      // Every spare part sold this month — a walk-in office sale
      // (ticket_id null) and one sold as part of confirming a job
      // (ticket_id set, from the "Finished Installation/Service" card)
      // both land in the same table now; part_name alone tells a flat
      // service-charge line apart from an actual part.
      supabaseAdmin.from('spare_part_sales').select('total, part_name').gte('created_at', monthStartISO),
    ]);

    // Grouped per person, not per order — a customer with two open orders
    // is one line showing what they owe in total. Last-called is the most
    // recent call across all their open orders, so the owner can judge at
    // a glance whether anyone's actually followed up recently.
    const owedByCustomer = new Map<
      string,
      { name: string; phoneNumber: string; totalBalance: number; oldestCreatedAt: string; lastPaymentCallAt: string | null; orderCount: number }
    >();
    for (const o of paymentsOutstanding.data ?? []) {
      const customer = (o.tickets as unknown as { customers: { name: string; phone_number: string } }).customers;
      const key = customer.phone_number;
      const existing = owedByCustomer.get(key);
      if (existing) {
        existing.totalBalance += Number(o.balance_owed);
        existing.orderCount += 1;
        if (o.created_at < existing.oldestCreatedAt) existing.oldestCreatedAt = o.created_at;
        if (o.last_payment_call_at && (!existing.lastPaymentCallAt || o.last_payment_call_at > existing.lastPaymentCallAt)) {
          existing.lastPaymentCallAt = o.last_payment_call_at;
        }
      } else {
        owedByCustomer.set(key, {
          name: customer.name,
          phoneNumber: customer.phone_number,
          totalBalance: Number(o.balance_owed),
          oldestCreatedAt: o.created_at,
          lastPaymentCallAt: o.last_payment_call_at ?? null,
          orderCount: 1,
        });
      }
    }
    const paymentsOutstandingByPerson = [...owedByCustomer.values()].sort((a, b) => b.totalBalance - a.totalBalance);

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

    // Sales by category: the purifier itself (by products.category, from
    // sold_price), spare parts (office sale + whatever a tech sold on a
    // visit), and the flat service-charge line — clubbed into one table
    // for the owner instead of three separate places to look.
    const salesByCategory: Record<CategoryKey, number> & { other: number; spare: number; serviceCharge: number } = {
      KITCHEN: 0,
      VESSEL: 0,
      COMMERCIAL: 0,
      other: 0, // a sale with no linked product row (historical import, hand-typed "Other")
      spare: 0,
      serviceCharge: 0,
    };
    for (const o of monthOrders.data ?? []) {
      const category = (o.tickets as unknown as { products: { category: CategoryKey } | null } | null)?.products
        ?.category;
      if (category && CATEGORY_KEYS.includes(category)) salesByCategory[category] += Number(o.sold_price);
      else salesByCategory.other += Number(o.sold_price);
    }
    for (const s of monthSparePartSales.data ?? []) {
      if (isServiceChargeRow(s.part_name)) salesByCategory.serviceCharge += Number(s.total);
      else salesByCategory.spare += Number(s.total);
    }

    return Response.json({
      todaysJobs: todaysJobs.data ?? [],
      whoIsBusy,
      monthRevenue,
      salesByCategory,
      pendingLeaveCount: pendingLeave.data?.length ?? 0,
      passedToOwner: passedToOwner.data ?? [],
      paymentsOutstanding: paymentsOutstandingByPerson,
      commercialVesselEnquiries: commercialVesselEnquiries.data ?? [],
      weekJobs: weekJobs.data ?? [],
      jobsToDispatch: jobsToDispatch.data ?? [],
      weekStart: today,
      weekEnd,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
