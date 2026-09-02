import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// §2.3: service staff see only their own jobs. Price/discount/balance
// columns live on `orders`, not `tickets`, and this query never touches
// that table — so there's nothing to accidentally leak here even without
// relying on RLS alone.
export async function GET() {
  try {
    const user = await requireUser(['service_staff']);

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select(
        'id, kind, status, booked_date, booked_half_day, location, parent_installation_id, customers(name, address, area, phone_number)'
      )
      .eq('assigned_to_id', user.id)
      .in('status', ['booked', 'completed'])
      .order('booked_date', { ascending: true });

    if (error) throw error;
    return Response.json({ jobs: data });
  } catch (err) {
    return handleApiError(err);
  }
}
