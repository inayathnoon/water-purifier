import { requireUser, handleApiError } from '@/lib/api-auth';
import { reactivateStaffMember } from '@/lib/services/staff';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['developer']);
    const { id } = await params;
    const user = await reactivateStaffMember(id);
    return Response.json({ user });
  } catch (err) {
    return handleApiError(err);
  }
}
