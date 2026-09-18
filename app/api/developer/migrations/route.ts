import { requireUser, handleApiError } from '@/lib/api-auth';
import { listMigrationStatus } from '@/lib/services/migrations';

// Live business data — never served from a cache.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser(['developer']);
    const migrations = await listMigrationStatus();
    return Response.json({ migrations });
  } catch (err) {
    return handleApiError(err);
  }
}
