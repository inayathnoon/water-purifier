import { checkAndCreateYearlyServiceCalls } from '@/lib/services/warranty';

/**
 * Triggered nightly by GitHub Actions (see .github/workflows/nightly-jobs.yml).
 * Protected by a shared secret, not user auth — there's no signed-in user
 * when a cron job calls this.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await checkAndCreateYearlyServiceCalls();
    return Response.json(result);
  } catch (err) {
    console.error('Yearly service check failed:', err);
    return Response.json({ error: 'Job failed' }, { status: 500 });
  }
}
