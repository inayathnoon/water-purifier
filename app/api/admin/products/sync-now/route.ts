import { requireUser, handleApiError, ApiError } from '@/lib/api-auth';
import { syncProductsFromSheet } from '@/lib/services/products';
import { logNotification } from '@/lib/services/notifications';

// §9.2: "and whenever someone presses Sync now." — the Developer panel's
// button is the only entry point since 2026-09-05 (admin's own Products
// page dropped its copy of this button), so this is developer-only now.
export async function POST() {
  try {
    await requireUser(['developer']);
    const result = await syncProductsFromSheet();
    return Response.json(result);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401 && err.status !== 403) {
      await logNotification('product_sync_failed', 'failed', err.message);
    }
    return handleApiError(err);
  }
}
