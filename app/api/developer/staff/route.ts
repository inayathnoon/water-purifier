import { requireUser, handleApiError } from '@/lib/api-auth';
import { listStaff, createStaffMember } from '@/lib/services/staff';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser(['developer']);
    const staff = await listStaff();
    return Response.json({ staff });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser(['developer']);
    const body = await request.json();
    const user = await createStaffMember({ name: body.name, phone: body.phone, role: body.role });
    return Response.json({ user }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
