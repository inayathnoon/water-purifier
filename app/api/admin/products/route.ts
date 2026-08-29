import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

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
