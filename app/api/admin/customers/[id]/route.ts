import { requireUser, handleApiError } from '@/lib/api-auth';
import { getCustomerWithHistory, updateCustomer } from '@/lib/services/customers';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
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
