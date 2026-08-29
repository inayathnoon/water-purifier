import { syncProductsFromSheet } from '@/lib/services/products';
import { logNotification } from '@/lib/services/notifications';
import { ApiError } from '@/lib/api-auth';

// Nightly, via GitHub Actions (§9.2). Same secret pattern as the yearly
// service check — see .github/workflows/nightly-jobs.yml.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncProductsFromSheet();
    return Response.json(result);
  } catch (err) {
    // §9.6: fail loudly and tell somebody — nobody's watching a nightly
    // cron run in real time, so the failure has to leave a visible trail.
    const message = err instanceof ApiError ? err.message : 'Unknown sync error';
    await logNotification('product_sync_failed', 'failed', message);
    console.error('Product sync failed:', err);
    return Response.json({ error: message }, { status: err instanceof ApiError ? err.status : 500 });
  }
}
