import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

// List of service staff, for populating the "assign to" dropdown when booking a job.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .eq('role', 'service_staff')
      .order('name');

    if (error) throw error;
    return Response.json({ staff: data });
  } catch (err) {
    return handleApiError(err);
  }
}
