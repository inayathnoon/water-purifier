import { requireUser, handleApiError } from '@/lib/api-auth';
import { searchCustomers } from '@/lib/services/customers';

// Backs the admin customer directory — search by phone number or name,
// either partial.
export async function GET(request: Request) {
  try {
    await requireUser(['admin', 'owner']);
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const customers = await searchCustomers(q);
    return Response.json({ customers });
  } catch (err) {
    return handleApiError(err);
  }
}
