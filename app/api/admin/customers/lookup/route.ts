import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// Autofill: typing a phone number that's already a customer fills in
// their name/address/area, on the New Purchase form and anywhere else
// that needs a quick "do we know this number" check.
export async function GET(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const phone = new URL(request.url).searchParams.get('phone')?.trim();
    if (!phone) return Response.json({ customer: null });

    const { data, error } = await supabaseAdmin
      .from('customers')
      .select('id, phone_number, name, address, area')
      .eq('phone_number', phone)
      .maybeSingle();

    if (error) throw error;
    return Response.json({ customer: data });
  } catch (err) {
    return handleApiError(err);
  }
}
