import { requireUser, handleApiError } from '@/lib/api-auth';
import { updatePurchase } from '@/lib/services/tickets';

// Correcting a purchase's product or price — only while unpaid and
// unvisited (see updatePurchase()). The customer itself isn't editable
// here; a wrong-customer purchase goes through Void instead.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const order = await updatePurchase(id, {
      productCode: body.productCode,
      productDetails: body.productDetails,
      listPrice: body.listPrice != null ? Number(body.listPrice) : undefined,
      soldPrice: body.soldPrice != null ? Number(body.soldPrice) : undefined,
      billDate: body.billDate,
    });

    return Response.json({ order });
  } catch (err) {
    return handleApiError(err);
  }
}
