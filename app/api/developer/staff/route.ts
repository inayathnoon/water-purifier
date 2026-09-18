import { requireUser, handleApiError } from '@/lib/api-auth';
import { listStaff, createStaffMember } from '@/lib/services/staff';

// Never cached — a stale response here means real business data
// (a purchase, an enquiry, a balance owed) silently going out of
// date on every device until the next deploy, immune to any client-
// side refresh. Found live 2026-09-18: a real purchase (NASAR,
// 9072917796) was missing from /admin/orders on multiple devices
// after a hard refresh each time — the DB and the exact query this
// route runs both had it correctly sorted first; only a cached
// response explains the same wrong answer surviving every reload.
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
