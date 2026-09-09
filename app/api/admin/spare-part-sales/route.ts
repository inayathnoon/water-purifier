import { requireUser, handleApiError } from '@/lib/api-auth';
import { recordSparePartSale, listRecentSparePartSales, listSparePartSalesForTicket } from '@/lib/services/sparePartSales';

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
