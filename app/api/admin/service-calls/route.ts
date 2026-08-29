import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// §8.2/§8.3: service_visit tickets through their whole life — from "does
// this customer need service?" through booked/completed to confirm-and-close.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('*, customers(*), users:assigned_to_id(name)')
      .eq('kind', 'service_visit')
      .not('status', 'in', '(closed,inactive)')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return Response.json({ serviceCalls: data });
  } catch (err) {
    return handleApiError(err);
  }
}
