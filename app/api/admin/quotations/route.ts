import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { createQuotation, listQuotations } from '@/lib/services/quotations';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser(['admin', 'owner']);
    const quotations = await listQuotations();
    return Response.json({ quotations });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(['admin']);
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new ApiError(400, 'At least one item is required');
    }

    const quotation = await createQuotation(
      {
        customerId: body.customerId || null,
        customerName: body.customerName ?? '',
        phoneNumber: body.phoneNumber ?? '',
        email: body.email || null,
        address: body.address ?? '',
        area: body.area ?? '',
        quoteDate: body.quoteDate,
        notes: body.notes,
        terms: body.terms,
        deliveryDate: body.deliveryDate,
        discount: body.discount != null ? Number(body.discount) : 0,
        items: body.items.map((it: { particulars: string; details?: string; qty?: number; rate?: number; productCode?: string }) => ({
          particulars: it.particulars,
          details: it.details ?? null,
          qty: Number(it.qty) || 1,
          rate: Number(it.rate) || 0,
          productCode: it.productCode || null,
        })),
      },
      user.id
    );

    return Response.json({ quotation }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
