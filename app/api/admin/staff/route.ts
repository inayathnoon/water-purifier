import { requireUser, handleApiError } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { getApprovedLeaveByStaff } from '@/lib/services/leave';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

// List of service staff, for populating the "assign to" dropdown when
// booking a job. §11.5: includes each person's approved leave so the
// booking screen can show it as context — never as a block.
export async function GET() {
  try {
    // 'developer' included so the Developer panel's "View As" previews
    // (both admin and owner dashboards use this for the assign-staff list) work.
    await requireUser(['admin', 'owner', 'developer']);

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .eq('role', 'service_staff')
      .eq('active', true)
      .order('name');

    if (error) throw error;

    const leaveByStaff = await getApprovedLeaveByStaff();
    const staff = (data ?? []).map((s) => ({ ...s, approvedLeave: leaveByStaff[s.id] ?? [] }));

    return Response.json({ staff });
  } catch (err) {
    return handleApiError(err);
  }
}
