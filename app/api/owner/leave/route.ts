import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// §11.3: only an owner decides — this whole namespace is owner-only,
// unlike most admin/owner-interchangeable routes elsewhere in the app.
export async function GET() {
  try {
    await requireUser(['owner']);

    const { data, error } = await supabaseAdmin
      .from('leave_requests')
      .select('*, users:requester_id(name)')
      .order('status', { ascending: true }) // pending first
      .order('created_at', { ascending: false });

    if (error) throw error;
    return Response.json({ requests: data });
  } catch (err) {
    return handleApiError(err);
  }
}
