import { requireUser, handleApiError } from '@/lib/api-auth';
import { getQuotationDefaults, updateQuotationDefaults } from '@/lib/services/quotations';

export async function GET() {
  try {
    await requireUser(['admin', 'owner']);
    const defaults = await getQuotationDefaults();
    return Response.json({ defaults });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();
    const defaults = await updateQuotationDefaults(body);
    return Response.json({ defaults });
  } catch (err) {
    return handleApiError(err);
  }
}
