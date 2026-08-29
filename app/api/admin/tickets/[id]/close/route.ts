import { requireUser, handleApiError } from '@/lib/api-auth';
import { closeTicketAfterConfirmation } from '@/lib/services/tickets';

// §6.7/§7.1: admin closes a completed job after telephoning the customer to
// confirm the work was done properly. For an installation this is the exact
// moment the order is created.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;

    const result = await closeTicketAfterConfirmation(id);
    return Response.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
