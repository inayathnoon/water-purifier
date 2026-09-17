'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatINR, toStartCase } from '@/lib/format';

export interface QuotationSheetItem {
  particulars: string;
  details: string | null;
  qty: number;
  rate: number;
  amount: number;
}

export interface QuotationSheetData {
  id: string;
  public_token: string;
  quote_no: number;
  quote_date: string;
  customer_name: string;
  phone_number: string;
  email: string | null;
  address: string;
  area: string;
  notes: string | null;
  terms: string | null;
  subtotal: number;
  discount: number;
  total: number;
  items: QuotationSheetItem[];
}

export interface QuotationSheetDefaults {
  business_name: string;
  address: string;
  phone: string;
  mobile: string;
  email: string;
  delivery_date_label: string;
  signatory_line: string;
  quote_prefix: string;
  print_mode: 'blank' | 'letterhead';
}

// Filler rows so a short quotation's table still reaches a consistent
// height on the page — the book's own ruled grid is the look; a 2-item
// table that stops a third of the way down reads as unfinished.
const MIN_TABLE_ROWS = 8;

function DropletWatermark() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        opacity: 0.06,
        color: 'var(--color-accent)',
        pointerEvents: 'none',
      }}
      className="print-color-adjust"
    >
      <svg width="300" height="300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
      </svg>
      <p className="font-condensed uppercase" style={{ fontSize: 32, letterSpacing: '0.08em', marginTop: -40 }}>
        Noon Enterprises
      </p>
    </div>
  );
}

export default function QuotationSheet({
  quotation,
  defaults,
  isPublic,
  backHref,
  editHref,
  appUrlOrigin,
}: {
  quotation: QuotationSheetData;
  defaults: QuotationSheetDefaults;
  isPublic: boolean;
  backHref?: string;
  editHref?: string;
  // Base URL used to build the /q/<token> link for WhatsApp/Email/Copy —
  // built server-side from APP_URL, never window.location.origin.
  appUrlOrigin: string;
}) {
  const [printMode, setPrintMode] = useState<'blank' | 'letterhead'>(defaults.print_mode);
  const [copied, setCopied] = useState(false);
  const quoteNoLabel = `${defaults.quote_prefix ? `${defaults.quote_prefix}-` : ''}${String(quotation.quote_no).padStart(3, '0')}`;
  const publicUrl = `${appUrlOrigin}/q/${quotation.public_token}`;

  const setModeAndRemember = (mode: 'blank' | 'letterhead') => {
    setPrintMode(mode);
    if (!isPublic) {
      fetch('/api/admin/quotation-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printMode: mode }),
      }).catch(() => {});
    }
  };

  const waMessage = [
    `${defaults.business_name} — Quotation No. ${quoteNoLabel}`,
    `Grand total: ${formatINR(quotation.total)}`,
    publicUrl,
  ].join('\n');

  const waDigits = (() => {
    let d = (quotation.phone_number || '').replace(/[\s+]/g, '');
    if (d.startsWith('0')) d = d.slice(1);
    return d.length === 10 ? `91${d}` : '';
  })();

  const filler = Math.max(0, MIN_TABLE_ROWS - quotation.items.length);

  return (
    <div>
      <div className="print:hidden bg-inset border-b border-rule px-4 py-3 flex flex-wrap items-center gap-3">
        {backHref && (
          <Link href={backHref} className="text-[13px] text-accent-deep hover:underline">
            ← Quotations
          </Link>
        )}
        {editHref && (
          <Link href={editHref} className="text-[13px] text-accent-deep hover:underline">
            Edit
          </Link>
        )}
        <button onClick={() => window.print()} className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold">
          Print
        </button>
        <div>
          <button onClick={() => window.print()} className="px-3 py-1.5 border border-rule text-[13px] hover:bg-accent-tint">
            Download PDF
          </button>
          <p className="text-[11px] text-ink-2 mt-0.5">Choose &quot;Save as PDF&quot; as the destination.</p>
        </div>
        {waDigits ? (
          <a
            href={`https://wa.me/${waDigits}?text=${encodeURIComponent(waMessage)}`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 border border-rule text-[13px] hover:bg-accent-tint"
          >
            WhatsApp
          </a>
        ) : (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(waMessage)}`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 border border-rule text-[13px] hover:bg-accent-tint"
            title="No valid 10-digit number on file — opens WhatsApp without a recipient"
          >
            WhatsApp
          </a>
        )}
        {quotation.email ? (
          <a
            href={`mailto:${quotation.email}?subject=${encodeURIComponent(`Quotation ${quoteNoLabel} — ${defaults.business_name}`)}&body=${encodeURIComponent(waMessage)}`}
            className="px-3 py-1.5 border border-rule text-[13px] hover:bg-accent-tint"
          >
            Email
          </a>
        ) : (
          <button
            disabled
            title="No email on file for this quotation"
            className="px-3 py-1.5 border border-rule text-[13px] text-ink-2 opacity-50 cursor-not-allowed"
          >
            Email
          </button>
        )}
        <button
          onClick={() => {
            navigator.clipboard?.writeText(publicUrl).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="text-[13px] text-ink-2 hover:underline"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <div className="ml-auto flex border border-rule">
          <button
            onClick={() => setModeAndRemember('blank')}
            className={`px-3 h-9 text-[12px] ${printMode === 'blank' ? 'bg-accent-tint text-accent-deep font-semibold' : 'text-ink-2'}`}
          >
            Blank paper
          </button>
          <button
            onClick={() => setModeAndRemember('letterhead')}
            className={`px-3 h-9 text-[12px] ${printMode === 'letterhead' ? 'bg-accent-tint text-accent-deep font-semibold' : 'text-ink-2'}`}
          >
            Letterhead pad
          </button>
        </div>
      </div>

      <style>{`
        .q-sheet-page { width: 210mm; min-height: 297mm; margin: 0 auto; background: white; position: relative; padding: 12mm; }
        @media print {
          @page { size: A4; margin: 12mm; }
          .q-sheet-page { width: auto; min-height: auto; margin: 0; padding: 0; }
          .print-color-adjust { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
        @media screen and (max-width: 380px) {
          .q-sheet-page { transform: scale(0.42); transform-origin: top left; margin-bottom: -420mm; }
        }
      `}</style>

      <div className="q-sheet-page text-[13px]" style={{ color: 'var(--color-ink)' }}>
        <DropletWatermark />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {printMode === 'blank' ? (
            <div className="text-center mb-4">
              <h1 className="font-condensed uppercase" style={{ fontSize: 34, letterSpacing: '0.02em' }}>
                <span style={{ fontWeight: 800 }}>NOON</span> <span style={{ fontWeight: 500 }}>ENTERPRISES</span>
              </h1>
              <p style={{ fontSize: 11 }}>{defaults.address}</p>
              <p style={{ fontSize: 11 }}>Phone: {defaults.phone}, Mob. {defaults.mobile}</p>
              <p style={{ fontSize: 11 }}>E-mail: {defaults.email}</p>
            </div>
          ) : (
            // Pre-printed letterhead already carries the masthead — leave
            // the same vertical space for it so the table starts at the
            // same point either way. Measure the real pad and adjust
            // --letterhead-gap once; nothing here shifts horizontally.
            <div style={{ height: 'var(--letterhead-gap, 42mm)' }} />
          )}

          <div className="flex justify-between items-baseline mb-2">
            <p className="uppercase font-semibold" style={{ fontSize: 12, letterSpacing: '0.08em' }}>Quotation</p>
            <p style={{ fontSize: 12 }}>Date: {quotation.quote_date}</p>
          </div>

          <div className="border-t border-b border-ink py-2 mb-3" style={{ borderColor: '#000' }}>
            <div className="flex justify-between mb-1">
              <p style={{ fontSize: 12 }}>No. {quoteNoLabel}</p>
            </div>
            <p style={{ fontSize: 13 }}>M/s. {toStartCase(quotation.customer_name || '')}</p>
            <p style={{ fontSize: 12 }}>{quotation.address}{quotation.address && quotation.area ? ', ' : ''}{quotation.area}</p>
            <p style={{ fontSize: 12 }}>Mob: {quotation.phone_number}</p>
          </div>

          <table className="w-full mb-3" style={{ borderCollapse: 'collapse', border: '1px solid #000' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000', padding: '4px 6px', fontSize: 11, textTransform: 'uppercase', textAlign: 'left' }}>Particulars</th>
                <th style={{ border: '1px solid #000', padding: '4px 6px', fontSize: 11, textTransform: 'uppercase', width: 50 }}>Qty.</th>
                <th style={{ border: '1px solid #000', padding: '4px 6px', fontSize: 11, textTransform: 'uppercase', width: 80, textAlign: 'right' }}>Rate</th>
                <th style={{ border: '1px solid #000', padding: '4px 6px', fontSize: 11, textTransform: 'uppercase', width: 90, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items.map((it, i) => (
                <tr key={i}>
                  <td style={{ border: '1px solid #000', padding: '4px 6px', verticalAlign: 'top' }}>
                    <p>{it.particulars}</p>
                    {it.details && (
                      <div style={{ fontSize: 11, marginLeft: 8, marginTop: 2, whiteSpace: 'pre-wrap' }}>{it.details}</div>
                    )}
                  </td>
                  <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'center' }} className="tabular-nums">{it.qty}</td>
                  <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right' }} className="tabular-nums">{formatINR(it.rate)}</td>
                  <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right' }} className="tabular-nums">{formatINR(it.amount)}</td>
                </tr>
              ))}
              {Array.from({ length: filler }).map((_, i) => (
                <tr key={`filler-${i}`}>
                  <td style={{ border: '1px solid #000', padding: '4px 6px', height: 22 }}>&nbsp;</td>
                  <td style={{ border: '1px solid #000' }}></td>
                  <td style={{ border: '1px solid #000' }}></td>
                  <td style={{ border: '1px solid #000' }}></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex gap-4 mb-4">
            <div className="flex-1 border border-ink p-3" style={{ borderColor: '#000', minHeight: 90 }}>
              <p style={{ fontSize: 11, fontWeight: 600 }}>DSA details &amp; signature</p>
              <p style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{quotation.notes}</p>
            </div>
            <div className="w-56">
              <div className="flex justify-between border-t border-rule pt-1">
                <span className="text-ink-2">Total</span>
                <span className="tabular-nums">{formatINR(quotation.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-2">Discount</span>
                <span className="tabular-nums">−{formatINR(quotation.discount)}</span>
              </div>
              <div className="flex justify-between border-t-2 pt-1 font-semibold" style={{ borderColor: 'var(--color-accent)' }}>
                <span>Grand total</span>
                <span className="tabular-nums">{formatINR(quotation.total)}</span>
              </div>
            </div>
          </div>

          {printMode === 'blank' && (
            <div className="flex justify-between items-end" style={{ fontSize: 10 }}>
              <div>
                {(quotation.terms || '').split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
                <p>{defaults.delivery_date_label}</p>
                <p style={{ marginTop: 12 }}>Party&apos;s signature</p>
              </div>
              <div className="text-right">
                <p>For {defaults.business_name}</p>
                <p style={{ marginTop: 24 }}>{defaults.signatory_line}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
