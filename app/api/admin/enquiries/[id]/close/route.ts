import { requireUser, handleApiError } from '@/lib/api-auth';
import { closeEnquiry } from '@/lib/services/tickets';

// §5.3: action is one of call_back_later | pass_to_owner | mark_inactive | convert.
// All the hard-rule validation (30 words, must-have-called) lives inside
// closeEnquiry() — this route is a thin pass-through on purpose.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'owner']);
    const { id } = await params;
    const body = await request.json();

    const result = await closeEnquiry(id, body.action, {
      explanation: body.explanation,
      callbackDate: body.callbackDate,
      linkedPurchaseNote: body.linkedPurchaseNote,
    });

    return Response.json({ ticket: result });
  } catch (err) {
    return handleApiError(err);
  }
}
