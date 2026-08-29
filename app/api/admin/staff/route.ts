import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { getApprovedLeaveByStaff } from '@/lib/services/leave';

// List of service staff, for populating the "assign to" dropdown when
// booking a job. §11.5: includes each person's approved leave so the
// booking screen can show it as context — never as a block.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .eq('role', 'service_staff')
      .order('name');

    if (error) throw error;

    const leaveByStaff = await getApprovedLeaveByStaff();
    const staff = (data ?? []).map((s) => ({ ...s, approvedLeave: leaveByStaff[s.id] ?? [] }));

    return Response.json({ staff });
  } catch (err) {
    return handleApiError(err);
  }
}
