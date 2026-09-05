import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { syncProductsFromSheet, updateProductListPriceInSheet } from '@/lib/services/products';

// Adding a brand-new product from the app was removed 2026-09-05 — new
// products are only ever added by editing the sheet directly, then
// syncing (here, or the Developer panel's "Sync products now"). Editing
// an existing product's price stays in-app (PATCH below).

// Editing a single product's list price — writes the sheet's own cell,
// same "sheet stays the source of truth" rule as adding a product, then
// re-syncs so it shows up here immediately.
export async function PATCH(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const body = await request.json();
    const sku = (body.sku ?? '').trim();
    if (!sku) throw new ApiError(400, 'SKU is required');
    const listPrice = body.listPrice === '' || body.listPrice == null ? null : Number(body.listPrice);

    await updateProductListPriceInSheet(sku, listPrice);
    const result = await syncProductsFromSheet();

    return Response.json({ updated: sku, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .order('active', { ascending: false })
      .order('category')
      .order('name');

    if (error) throw error;
    return Response.json({ products: data });
  } catch (err) {
    return handleApiError(err);
  }
}
