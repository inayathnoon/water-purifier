'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import QuotationForm from '@/components/QuotationForm';
import { formatINR, toStartCase } from '@/lib/format';
import { daysAgoIST } from '@/lib/dates';

interface QuotationRow {
  id: string;
  quote_no: number;
  quote_date: string;
  customer_name: string;
  phone_number: string;
  total: number;
  status: 'open' | 'won' | 'lost';
  created_at: string;
  quotation_items: { particulars: string }[];
}

const STATUS_CLASS: Record<string, string> = {
  open: 'text-ink-2',
  won: 'bg-ok-tint text-ok px-1.5 py-0.5',
  lost: 'bg-inset text-ink-2 px-1.5 py-0.5',
};

function QuotationsIndex() {
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'won' | 'lost'>('all');
  const [quotePrefix, setQuotePrefix] = useState('Q');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [qRes, dRes] = await Promise.all([fetch('/api/admin/quotations', { cache: 'no-store' }), fetch('/api/admin/quotation-defaults', { cache: 'no-store' })]);
    setQuotations((await qRes.json()).quotations ?? []);
    setQuotePrefix((await dRes.json()).defaults.quote_prefix ?? 'Q');
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const q = query.trim().toLowerCase();
  const visible = quotations.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (!q) return true;
    return (
      row.customer_name?.toLowerCase().includes(q) ||
      row.phone_number?.includes(q) ||
      String(row.quote_no).includes(q)
    );
  });
  const openCount = quotations.filter((r) => r.status === 'open').length;

  const setStatus = async (id: string, status: 'won' | 'lost') => {
    await fetch(`/api/admin/quotations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setMenuOpenId(null);
    load();
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="font-condensed text-[22px] uppercase tracking-[0.04em]">Quotations</h1>
        <Link href="/admin/quotations?new=1" className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold">
          + New quotation
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          placeholder="Search name, phone, or number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 border border-rule rounded-xs px-3 text-[13px] flex-1 min-w-[200px]"
        />
        <div className="flex border border-rule">
          {(['all', 'open', 'won', 'lost'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 h-10 text-[12px] uppercase tracking-[0.05em] ${statusFilter === s ? 'bg-accent-tint text-accent-deep font-semibold' : 'text-ink-2'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-ink-2">
          {quotations.length} quotations · {openCount} open
        </span>
      </div>

      {loading ? (
        <p className="text-ink-2 text-[13px]">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-ink-2 text-[13px]">
          No quotations yet. <Link href="/admin/quotations?new=1" className="text-accent-deep hover:underline">New quotation</Link>
        </p>
      ) : (
        <div className="bg-surface border border-rule overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-inset text-left">
              <tr>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">No.</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Date</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Customer</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Items</th>
                <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Total</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Status</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Age</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {visible.map((row) => {
                const items = row.quotation_items ?? [];
                const itemsLabel = items.length > 0 ? `${items[0].particulars}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : '—';
                return (
                  <tr key={row.id} style={{ height: 48 }} className="hover:bg-accent-tint">
                    <td className="p-3 tabular-nums">
                      <Link href={`/admin/quotations/${row.id}`} className="block">
                        {quotePrefix}-{String(row.quote_no).padStart(3, '0')}
                      </Link>
                    </td>
                    <td className="p-3 whitespace-nowrap tabular-nums">
                      <Link href={`/admin/quotations/${row.id}`} className="block">{row.quote_date}</Link>
                    </td>
                    <td className="p-3">
                      <Link href={`/admin/quotations/${row.id}`} className="block">
                        <p className="font-medium capitalize">{toStartCase(row.customer_name || '')}</p>
                        <p className="text-[12px] text-ink-2">{row.phone_number}</p>
                      </Link>
                    </td>
                    <td className="p-3 max-w-xs truncate">
                      <Link href={`/admin/quotations/${row.id}`} className="block truncate">{itemsLabel}</Link>
                    </td>
                    <td className="p-3 text-right font-semibold tabular-nums">
                      <Link href={`/admin/quotations/${row.id}`} className="block">{formatINR(row.total)}</Link>
                    </td>
                    <td className="p-3">
                      <span className={`text-[11px] font-semibold uppercase tracking-[0.05em] ${STATUS_CLASS[row.status]}`}>{row.status}</span>
                    </td>
                    <td className="p-3 whitespace-nowrap text-ink-2 tabular-nums">{daysAgoIST(row.created_at)}d</td>
                    <td className="p-3 text-right relative">
                      <button
                        onClick={() => setMenuOpenId(menuOpenId === row.id ? null : row.id)}
                        className="text-ink-2 hover:text-ink px-2"
                      >
                        ⋯
                      </button>
                      {menuOpenId === row.id && (
                        <div className="absolute right-2 top-9 z-10 bg-surface border border-rule text-left w-40">
                          <Link href={`/admin/quotations/${row.id}?edit=1`} className="block px-3 py-2 hover:bg-accent-tint">Edit</Link>
                          <Link href={`/admin/quotations/${row.id}`} className="block px-3 py-2 hover:bg-accent-tint">Print</Link>
                          <Link href={`/admin/quotations?new=1&duplicate=${row.id}`} className="block px-3 py-2 hover:bg-accent-tint">Duplicate</Link>
                          <button onClick={() => setStatus(row.id, 'won')} className="w-full text-left px-3 py-2 hover:bg-accent-tint">Mark won</button>
                          <button onClick={() => setStatus(row.id, 'lost')} className="w-full text-left px-3 py-2 hover:bg-accent-tint">Mark lost</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuotationsPageInner() {
  const searchParams = useSearchParams();
  const isNew = searchParams.get('new') === '1';
  const duplicateFromId = searchParams.get('duplicate') || undefined;

  return (
    <AppShell title="Quotations">
      {isNew ? <QuotationForm duplicateFromId={duplicateFromId} /> : <QuotationsIndex />}
    </AppShell>
  );
}

export default function QuotationsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-ink-2 text-[13px]">Loading…</div>}>
      <QuotationsPageInner />
    </Suspense>
  );
}
