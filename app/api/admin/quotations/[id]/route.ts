import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { getQuotation, updateQuotation, setQuotationStatus } from '@/lib/services/quotations';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const quotation = await getQuotation(id);
    // Server-only env, read here so the client page never needs its own
    // access to it — WhatsApp/Email/Copy link all build off this, never
    // window.location.origin (see lib/services/notifications.ts's appUrl()).
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    return Response.json({ quotation, appUrl });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    // A bare status-only PATCH (Mark won / Mark lost from the index row
    // menu) — no items/customer in the body at all.
    if (body.status && Object.keys(body).length === 1) {
      const quotation = await setQuotationStatus(id, body.status);
      return Response.json({ quotation });
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new ApiError(400, 'At least one item is required');
    }

    const quotation = await updateQuotation(id, {
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
      status: body.status,
      items: body.items.map((it: { particulars: string; details?: string; qty?: number; rate?: number; productCode?: string }) => ({
        particulars: it.particulars,
        details: it.details ?? null,
        qty: Number(it.qty) || 1,
        rate: Number(it.rate) || 0,
        productCode: it.productCode || null,
      })),
    });

    return Response.json({ quotation });
  } catch (err) {
    return handleApiError(err);
  }
}
