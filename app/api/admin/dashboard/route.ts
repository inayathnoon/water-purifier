import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

/**
 * §15.1: everyone the admin needs to call today, on one screen — new
 * enquiries, customers to confirm finished work with, yearly service
 * calls due, payments outstanding. One query per category, all fired
 * together; no page-to-page navigating required to see all four.
 */
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);
    const today = new Date().toISOString().slice(0, 10);

    const [newEnquiries, awaitingConfirmation, serviceCallsDue, paymentsOutstanding] = await Promise.all([
      // §5: open enquiries, oldest first so 14+ day ones are already at the top (§5.6/§15.4).
      supabaseAdmin
        .from('tickets')
        .select('id, created_at, enquiry_product_interest, customers(name, phone_number)')
        .eq('kind', 'enquiry')
        .eq('status', 'open')
        .order('created_at', { ascending: true }),

      // §6.7: completed jobs waiting on the admin's confirmation call.
      supabaseAdmin
        .from('tickets')
        .select('id, kind, actual_date, customers(name, phone_number)')
        .in('kind', ['installation', 'service_visit'])
        .eq('status', 'completed')
        .order('actual_date', { ascending: true }),

      // §8.2: yearly service calls the cron created, not yet asked about.
      supabaseAdmin
        .from('tickets')
        .select('id, warranty_expires_at, customers(name, phone_number)')
        .eq('kind', 'service_visit')
        .eq('status', 'open')
        .order('warranty_expires_at', { ascending: true }),

      // §7.3/§7.6/§15.6: every order still owed, with discount visible.
      supabaseAdmin
        .from('orders')
        .select('id, sold_price, discount, balance_owed, last_payment_call_at, tickets(customers(name, phone_number))')
        .eq('status', 'open')
        .order('balance_owed', { ascending: false }),
    ]);

    const oldEnquiryCount = (newEnquiries.data ?? []).filter(
      (e) => Math.floor((Date.now() - new Date(e.created_at).getTime()) / 86400000) >= 14
    ).length;

    const overdueCallCount = (paymentsOutstanding.data ?? []).filter((o) => {
      const days = o.last_payment_call_at
        ? Math.floor((Date.now() - new Date(o.last_payment_call_at).getTime()) / 86400000)
        : Infinity;
      return days >= 3;
    }).length;

    return Response.json({
      newEnquiries: newEnquiries.data ?? [],
      oldEnquiryCount,
      awaitingConfirmation: awaitingConfirmation.data ?? [],
      serviceCallsDue: serviceCallsDue.data ?? [],
      paymentsOutstanding: paymentsOutstanding.data ?? [],
      overdueCallCount,
      today,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
