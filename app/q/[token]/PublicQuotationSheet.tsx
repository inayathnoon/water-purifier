'use client';

import QuotationSheet, { type QuotationSheetData, type QuotationSheetDefaults } from '@/components/QuotationSheet';

export default function PublicQuotationSheet({
  quotation,
  defaults,
  appUrl,
}: {
  quotation: QuotationSheetData;
  defaults: QuotationSheetDefaults;
  appUrl: string;
}) {
  // No back/edit links, no login, no sidebar — a customer opening this
  // from WhatsApp/email gets the sheet and nothing else.
  return <QuotationSheet quotation={quotation} defaults={defaults} isPublic appUrlOrigin={appUrl} />;
}
