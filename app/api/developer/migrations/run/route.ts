import { requireUser, handleApiError } from '@/lib/api-auth';
import { runPendingMigrations } from '@/lib/services/migrations';

export async function POST() {
  try {
    await requireUser(['developer']);
    const result = await runPendingMigrations();
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
