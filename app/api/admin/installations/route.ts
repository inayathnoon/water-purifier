import { requireUser, handleApiError } from '@/lib/api-auth';
import { findOrCreateCustomer } from '@/lib/services/customers';
import { createDirectPurchase } from '@/lib/services/tickets';
import { supabaseAdmin } from '@/lib/db';

// A sale recorded directly, skipping the enquiry/call pipeline entirely —
// a walk-in or already-decided customer. Produces an installation ticket
// ready to book, exactly like a converted enquiry would.
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

    const result = await createDirectPurchase({
      customerId: customer.id,
      productDetails: body.productDetails ?? '',
      productCode: body.productCode || undefined,
      price: Number(body.price),
      paidAmount: Number(body.paidAmount ?? 0),
      plannedInstallationDate: body.plannedInstallationDate || undefined,
    });

    return Response.json({ customer, ...result }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

// Installations awaiting booking or in progress (not yet closed).
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('*, customers(*), users:assigned_to_id(name), orders(paid_amount, balance_owed)')
      .eq('kind', 'installation')
      .neq('status', 'closed')
      .neq('status', 'inactive')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return Response.json({ installations: data });
  } catch (err) {
    return handleApiError(err);
  }
}
