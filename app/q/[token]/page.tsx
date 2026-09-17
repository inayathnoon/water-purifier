import { notFound } from 'next/navigation';
import { getQuotationByToken, getQuotationDefaults } from '@/lib/services/quotations';
import PublicQuotationSheet from './PublicQuotationSheet';

// The public, unauthenticated read-only sheet — what a WhatsApp/email link
// opens. Server component: reads by public_token through supabaseAdmin
// directly (see lib/services/quotations.ts), never through a client-side
// fetch to an admin-only route. public_token is the only credential this
// route accepts — no id-based fallback exists anywhere here.
export default async function PublicQuotationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let quotation;
  try {
    quotation = await getQuotationByToken(token);
  } catch {
    notFound();
  }

  const defaults = await getQuotationDefaults();
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  // Narrowed to only what the printed sheet shows — created_by,
  // customer_id, status, and each item's product_code are cost/internal
  // fields that must never reach a public, unauthenticated payload, even
  // though the UI itself never renders them.
  const publicQuotation = {
    id: quotation.id,
    public_token: quotation.public_token,
    quote_no: quotation.quote_no,
    quote_date: quotation.quote_date,
    customer_name: quotation.customer_name,
    phone_number: quotation.phone_number,
    email: quotation.email,
    address: quotation.address,
    area: quotation.area,
    notes: quotation.notes,
    terms: quotation.terms,
    subtotal: quotation.subtotal,
    discount: quotation.discount,
    total: quotation.total,
    items: quotation.items.map((it: { particulars: string; details: string | null; qty: number; rate: number; amount: number }) => ({
      particulars: it.particulars,
      details: it.details,
      qty: it.qty,
      rate: it.rate,
      amount: it.amount,
    })),
  };

  return <PublicQuotationSheet quotation={publicQuotation} defaults={defaults} appUrl={appUrl} />;
}
