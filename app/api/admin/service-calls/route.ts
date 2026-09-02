import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { findOrCreateCustomer } from '@/lib/services/customers';
import { createAdHocServiceRequest } from '@/lib/services/tickets';

// A customer calling in with a problem any time — not tied to the
// 18-month yearly-service schedule (that's the "Mark service requested"
// action on the due-this-month list, /api/admin/service-calls/request).
export async function POST(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
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

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('*, customers(*), users:assigned_to_id(name)')
      .eq('kind', 'service_visit')
      .not('status', 'in', '(closed,inactive)')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return Response.json({ serviceCalls: data });
  } catch (err) {
    return handleApiError(err);
  }
}
