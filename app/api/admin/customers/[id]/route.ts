import { requireUser, handleApiError } from '@/lib/api-auth';
import { getCustomerWithHistory } from '@/lib/services/customers';

// §4.3: one customer's full history — every enquiry, installation,
// service visit, and order — on one page.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const result = await getCustomerWithHistory(id);
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
