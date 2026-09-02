import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { appendProductToSheet, syncProductsFromSheet } from '@/lib/services/products';

// The spreadsheet stays the source of truth — this writes the new
// product into the sheet first, then re-syncs immediately so it shows up
// on this page right away instead of waiting for the next nightly pull.
export async function POST(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const body = await request.json();

    const sku = (body.sku ?? '').trim();
    const category = (body.category ?? '').trim();
    const brand = (body.brand ?? '').trim();
    const productName = (body.productName ?? '').trim();
    const variant = (body.variant ?? '').trim();
    const listPrice = body.listPrice === '' || body.listPrice == null ? null : Number(body.listPrice);

    if (!sku || !category || !brand || !productName) {
      throw new ApiError(400, 'SKU, category, brand, and product name are all required');
    }

    await appendProductToSheet({ sku, category, brand, productName, variant, listPrice });
    const result = await syncProductsFromSheet();

    return Response.json({ added: sku, ...result }, { status: 201 });
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
