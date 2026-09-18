import { requireUser, handleApiError } from '@/lib/api-auth';
import { getYearlyServiceDueThisMonth } from '@/lib/services/warranty';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

// Read-time computed list — see getYearlyServiceDueThisMonth() for the
// "due this calendar month" rule. Nothing is created just by viewing this.
export async function GET() {
  try {
    await requireUser(['admin', 'owner']);
    const due = await getYearlyServiceDueThisMonth();
    return Response.json({ due });
  } catch (err) {
    return handleApiError(err);
  }
}
