import { requireUser, handleApiError } from '@/lib/api-auth';
import { recordSparePartSale, listRecentSparePartSales, listSparePartSalesForTicket } from '@/lib/services/sparePartSales';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const ticketId = new URL(request.url).searchParams.get('ticketId');
    const sales = ticketId ? await listSparePartSalesForTicket(ticketId) : await listRecentSparePartSales();
    return Response.json({ sales });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(['admin', 'owner']);
    const body = await request.json();

    const sale = await recordSparePartSale({
      items: body.items ?? [],
      customerName: body.customerName,
      phoneNumber: body.phoneNumber,
      soldBy: user.id,
      ticketId: body.ticketId || undefined,
    });

    return Response.json({ sale }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
