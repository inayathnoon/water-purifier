import { requireUser, handleApiError } from '@/lib/api-auth';
import { findCustomersByPhone, getDuplicateWarnings } from '@/lib/services/customers';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
export const dynamic = 'force-dynamic';

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
