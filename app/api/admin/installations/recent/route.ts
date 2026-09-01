import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// Backs the enquiry page's "Link to Existing Purchase" picker — recent
// installations (any status) to scroll through and pick from, for a sale
// that turns out to already be recorded separately from this enquiry.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('id, status, agreed_price, created_at, customers(name, phone_number)')
      .eq('kind', 'installation')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;
    return Response.json({ installations: data });
  } catch (err) {
    return handleApiError(err);
  }
}
