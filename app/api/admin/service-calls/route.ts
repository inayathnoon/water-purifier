import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { findOrCreateCustomer } from '@/lib/services/customers';
import { createAdHocServiceRequest } from '@/lib/services/tickets';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

// A customer calling in with a problem any time — not tied to the
// 18-month yearly-service schedule (that's the "Mark service requested"
// action on the due-this-month list, /api/admin/service-calls/request).
export async function POST(request: Request) {
  try {
    const user = await requireUser(['admin', 'owner']);
    const body = await request.json();

    const customer = await findOrCreateCustomer({
      phoneNumber: body.phoneNumber,
      name: body.name,
      address: body.address,
      area: body.area,
      customerId: body.customerId,
      forceNewAddress: body.forceNewAddress,
    });

    const ticket = await createAdHocServiceRequest({
      customerId: customer.id,
      productInterest: body.productInterest ?? '',
      issueNote: body.issueNote ?? '',
      staffAttendedId: body.staffAttendedId || undefined,
      bookedDate: body.bookedDate || undefined,
      bookedHalfDay: ['morning', 'afternoon', 'evening'].includes(body.bookedHalfDay) ? body.bookedHalfDay : undefined,
      location: body.location === 'office' ? 'office' : 'home',
      createdBy: user.id,
    });

    return Response.json({ customer, ticket }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

// §8.2/§8.3: service_visit tickets through their whole life — from "does
// this customer need service?" through booked/completed to confirm-and-close.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    // 'inactive' (declined/voided) stays excluded — genuinely not a real
    // visit any more. 'closed' is now included (widened from before) so a
    // completed visit's record stays reachable for an "Edit completion"
    // correction, the same way Purchases already shows every order
    // regardless of status.
    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('*, customers(*), users:assigned_to_id(name)')
      .eq('kind', 'service_visit')
      .neq('status', 'inactive')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return Response.json({ serviceCalls: data });
  } catch (err) {
    return handleApiError(err);
  }
}
