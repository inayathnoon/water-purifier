import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { syncProductsFromSheet } from '@/lib/services/products';
import { logNotification } from '@/lib/services/notifications';

// §9.2: "and whenever someone presses Sync now."
export async function POST() {
  try {
    await requireUser(['admin', 'owner', 'developer']);
    const result = await syncProductsFromSheet();
    return Response.json(result);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401 && err.status !== 403) {
      await logNotification('product_sync_failed', 'failed', err.message);
    }
    return handleApiError(err);
  }
}
