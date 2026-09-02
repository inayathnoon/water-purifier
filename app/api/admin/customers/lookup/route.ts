import { requireUser, handleApiError } from '@/lib/api-auth';
import { findCustomersByPhone, getDuplicateWarnings } from '@/lib/services/customers';

// Autofill: typing a phone number that's already a customer fills in
// their details. A number can have more than one address on file, so
// this returns every match — the form shows a picker when there's more
// than one, or a single auto-fill when there's exactly one. Also flags
// an already-open enquiry or a purchase recorded in the last 7 days for
// this number, so a fast double-entry doesn't slip through unnoticed.
export async function GET(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const phone = new URL(request.url).searchParams.get('phone')?.trim();
    if (!phone) return Response.json({ customers: [], warnings: { openEnquiries: [], recentPurchases: [] } });

    const [customers, warnings] = await Promise.all([findCustomersByPhone(phone), getDuplicateWarnings(phone)]);
    return Response.json({ customers, warnings });
  } catch (err) {
    return handleApiError(err);
  }
}
