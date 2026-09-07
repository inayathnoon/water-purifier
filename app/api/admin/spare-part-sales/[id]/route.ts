import { requireUser, handleApiError } from '@/lib/api-auth';
import { updateSparePartSale } from '@/lib/services/sparePartSales';

// Correcting a mistyped office sale — re-syncs the sheet row in place.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const sale = await updateSparePartSale(id, {
      partName: body.partName,
      unitPrice: body.unitPrice != null ? Number(body.unitPrice) : undefined,
      quantity: body.quantity != null ? Number(body.quantity) : undefined,
      customerName: body.customerName,
      phoneNumber: body.phoneNumber,
      saleDate: body.saleDate,
    });

    return Response.json({ sale });
  } catch (err) {
    return handleApiError(err);
  }
}
