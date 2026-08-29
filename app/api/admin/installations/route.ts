import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// Installations awaiting booking or in progress (not yet closed).
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('*, customers(*), users:assigned_to_id(name)')
      .eq('kind', 'installation')
      .neq('status', 'closed')
      .neq('status', 'inactive')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return Response.json({ installations: data });
  } catch (err) {
    return handleApiError(err);
  }
}
