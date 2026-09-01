import { requireUser, handleApiError } from '@/lib/api-auth';
import { findCustomersByPhone } from '@/lib/services/customers';

// Autofill: typing a phone number that's already a customer fills in
// their details. A number can have more than one address on file, so
// this returns every match — the form shows a picker when there's more
// than one, or a single auto-fill when there's exactly one.
export async function GET(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const phone = new URL(request.url).searchParams.get('phone')?.trim();
    if (!phone) return Response.json({ customers: [] });

    const customers = await findCustomersByPhone(phone);
    return Response.json({ customers });
  } catch (err) {
    return handleApiError(err);
  }
}
