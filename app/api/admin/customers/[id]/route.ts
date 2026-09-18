import { requireUser, handleApiError } from '@/lib/api-auth';
import { getCustomerWithHistory, updateCustomer } from '@/lib/services/customers';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

// §4.3: one customer's full history — every enquiry, installation,
// service visit, and order — on one page.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const result = await getCustomerWithHistory(id);
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

// Correcting a customer's own details — a typo'd phone number chief
// among them. Re-keys their existing sheet rows in the same operation;
// see updateCustomer() for why that has to happen here, not separately.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const customer = await updateCustomer(id, {
      phoneNumber: body.phoneNumber,
      name: body.name,
      address: body.address,
      area: body.area,
    });

    return Response.json({ customer });
  } catch (err) {
    return handleApiError(err);
  }
}
