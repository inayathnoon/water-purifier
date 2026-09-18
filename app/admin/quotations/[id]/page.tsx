'use client';

import { Suspense, useEffect, useState, use as usePromise } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import QuotationForm from '@/components/QuotationForm';
import QuotationSheet, { type QuotationSheetData, type QuotationSheetDefaults } from '@/components/QuotationSheet';

function PrintableSheet({ id }: { id: string }) {
  const [quotation, setQuotation] = useState<QuotationSheetData | null>(null);
  const [defaults, setDefaults] = useState<QuotationSheetDefaults | null>(null);
  const [appUrl, setAppUrl] = useState('');

  useEffect(() => {
    (async () => {
      const [qRes, dRes] = await Promise.all([fetch(`/api/admin/quotations/${id}`, { cache: 'no-store' }), fetch('/api/admin/quotation-defaults', { cache: 'no-store' })]);
      const qData = await qRes.json();
      const dData = await dRes.json();
      setQuotation(qData.quotation);
      setAppUrl(qData.appUrl);
      setDefaults(dData.defaults);
    })();
  }, [id]);

  if (!quotation || !defaults) return <p className="text-ink-2 text-[13px] p-6">Loading…</p>;

  return (
    <QuotationSheet
      quotation={quotation}
      defaults={defaults}
      isPublic={false}
      backHref="/admin/quotations"
      editHref={`/admin/quotations/${id}?edit=1`}
      appUrlOrigin={appUrl}
    />
  );
}

function QuotationDetailInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const searchParams = useSearchParams();
  const isEdit = searchParams.get('edit') === '1';

  // Only the edit form gets AppShell — the printable sheet is rendered
  // with nothing else on the page, since a sidebar and top bar have no
  // business appearing on (or interfering with printing) a document.
  if (isEdit) {
    return (
      <AppShell title="Quotations">
        <QuotationForm quotationId={id} />
      </AppShell>
    );
  }
  return <PrintableSheet id={id} />;
}

export default function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-ink-2 text-[13px]">Loading…</div>}>
      <QuotationDetailInner params={params} />
    </Suspense>
  );
}
