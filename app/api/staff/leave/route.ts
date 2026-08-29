import { requireUser, handleApiError } from '@/lib/api-auth';
import { requestLeave } from '@/lib/services/leave';
import { supabaseAdmin } from '@/lib/db';

// §11.1: a technician requests leave, giving dates and a reason.
export async function POST(request: Request) {
  try {
    const user = await requireUser(['service_staff']);
    const body = await request.json();

    const leave = await requestLeave(user.id, body.startDate, body.endDate, body.reason);
    return Response.json({ leave }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET() {
  try {
    const user = await requireUser(['service_staff']);

    const { data, error } = await supabaseAdmin
      .from('leave_requests')
      .select('*')
      .eq('requester_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return Response.json({ requests: data });
  } catch (err) {
    return handleApiError(err);
  }
}
