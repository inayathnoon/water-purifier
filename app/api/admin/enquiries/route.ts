import { requireUser, handleApiError } from '@/lib/api-auth';
import { findOrCreateCustomer } from '@/lib/services/customers';
import { createEnquiry } from '@/lib/services/tickets';
import { supabaseAdmin } from '@/lib/db';

// §5.1/§2.2: enquiries are owned by the admin. An owner may also create one
// when covering the admin's desk (§2.1).
export async function POST(request: Request) {
  try {
    const user = await requireUser(['admin', 'owner']);
    const body = await request.json();

    const customer = await findOrCreateCustomer({
      phoneNumber: body.phoneNumber,
      name: body.name,
      address: body.address,
      area: body.area,
    });

    const ticket = await createEnquiry({
      customerId: customer.id,
      productInterest: body.productInterest ?? '',
      createdBy: user.id,
      source: body.source,
      referrerName: body.referrerName,
      referrerPhone: body.referrerPhone,
    });

    return Response.json({ customer, ticket }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('*, customers(*)')
      .eq('kind', 'enquiry')
      .eq('status', 'open')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return Response.json({ enquiries: data });
  } catch (err) {
    return handleApiError(err);
  }
}
