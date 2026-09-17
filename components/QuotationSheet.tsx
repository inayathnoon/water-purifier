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
// table that stops a third of the way down reads as unfinished. A quote
// with 6+ items already fills the grid on its own.
const MIN_TABLE_ROWS = 6;

// The right-hand column's width in every one of the sheet's three
// bordered blocks (the item table's Qty+Rate+Amount columns, the
// totals box, the terms/signature box) — one shared constant so their
// vertical dividers line up exactly, instead of three near-but-not-
// quite-equal widths (220/224/240px) drifting visibly out of register
// down the page.
const RIGHT_COL_WIDTH = 220;

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
      <p className="font-condensed uppercase" style={{ fontSize: 32, letterSpacing: '0.08em', marginTop: 12 }}>
        Noon Enterprises
      </p>
    </div>
  );
}

// Four "+" glyphs at the sheet's corners — what actually makes it read
// as a drawn document rather than a table sitting on a page. Above the
// watermark, below nothing.
function RegistrationMarks() {
  const corner: React.CSSProperties = {
    position: 'absolute',
    fontSize: 13,
    lineHeight: 1,
    color: 'var(--color-accent-deep)',
    zIndex: 2,
    pointerEvents: 'none',
  };
  return (
    <div aria-hidden>
      <span style={{ ...corner, top: '6mm', left: '6mm' }}>+</span>
      <span style={{ ...corner, top: '6mm', right: '6mm' }}>+</span>
      <span style={{ ...corner, bottom: '6mm', left: '6mm' }}>+</span>
      <span style={{ ...corner, bottom: '6mm', right: '6mm' }}>+</span>
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
        .q-sheet-page { width: 210mm; min-height: 297mm; margin: 0 auto; background: white; position: relative; padding: 12mm 13mm; }
        @media print {
          /* margin: 0 leaves Chrome no margin box to draw its own
             header/footer (date, page URL, page count) into — that's
             what was printing on the document. The 12mm/13mm inset
             moves onto the sheet's own padding instead, at screen and
             print alike, so nothing shifts when printing. */
          @page { size: A4; margin: 0; }
          .q-sheet-page { width: auto; min-height: auto; margin: 0; padding: 12mm 13mm; }
          .print-color-adjust { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
        @media screen and (max-width: 380px) {
          .q-sheet-page { transform: scale(0.42); transform-origin: top left; margin-bottom: -420mm; }
        }
      `}</style>

      <div className="q-sheet-page text-[13px]" style={{ color: 'var(--color-ink)' }}>
        {/* The pre-printed letterhead pad already carries its own
            branding — a second faint watermark behind it would be
            redundant (or clash), so this only shows on blank paper. */}
        {printMode === 'blank' && <DropletWatermark />}
        <RegistrationMarks />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {printMode === 'blank' ? (
            // Exactly one wordmark line — NOON at full weight/ink,
            // ENTERPRISES lighter and in the accent, as the book prints
            // it. Address/phone/e-mail are three separate lines; if the
            // address line reads blank, quotation_defaults.address
            // itself is empty (fill it in via Header & terms) — the
            // paragraph is always rendered.
            <div className="text-center mb-4">
              <h1 className="font-condensed uppercase" style={{ fontSize: 36, letterSpacing: '0.02em', lineHeight: 1.1 }}>
                <span style={{ fontWeight: 700 }}>NOON</span>{' '}
                <span style={{ fontWeight: 400, color: 'var(--color-accent-deep)' }}>ENTERPRISES</span>
              </h1>
              <p style={{ fontSize: 10.5 }} className="text-ink-2">{defaults.address}</p>
              <p style={{ fontSize: 10.5 }} className="text-ink-2">Phone: {defaults.phone}, Mob. {defaults.mobile}</p>
              <p style={{ fontSize: 10.5 }} className="text-ink-2">E-mail: {defaults.email}</p>
            </div>
          ) : (
            // Pre-printed letterhead already carries the masthead — leave
            // the same vertical space for it so the table starts at the
            // same point either way. Measure the real pad and adjust
            // --letterhead-gap once; nothing here shifts horizontally.
            <div style={{ height: 'var(--letterhead-gap, 42mm)' }} />
          )}

          {/* A real band, not an inline row — hairlines above and below,
              tracked label left, date right. */}
          <div
            className="flex justify-between items-center mb-3"
            style={{ borderTop: '1px solid var(--color-accent-deep)', borderBottom: '1px solid var(--color-accent-deep)', padding: '3px 0' }}
          >
            <p className="font-condensed uppercase" style={{ fontSize: 15, letterSpacing: '0.3em' }}>Quotation</p>
            <p style={{ fontSize: 12 }}>Date: {quotation.quote_date}</p>
          </div>

          <div className="flex justify-between items-start mb-3">
            <div>
              <p style={{ fontSize: 13 }}>M/s. {toStartCase(quotation.customer_name || '')}</p>
              <p style={{ fontSize: 12 }}>{quotation.address}{quotation.address && quotation.area ? ', ' : ''}{quotation.area}</p>
              <p style={{ fontSize: 12 }}>Mob: {quotation.phone_number}</p>
            </div>
            {/* The sheet's identifier — set apart from the address block,
                not buried at its head. */}
            <p className="font-condensed" style={{ fontSize: 20, color: 'var(--color-accent-deep)', whiteSpace: 'nowrap' }}>
              No. {quoteNoLabel}
            </p>
          </div>

          {(() => {
            const hairline = '1px solid var(--color-accent-deep)';
            return (
              <table className="w-full" style={{ borderCollapse: 'collapse', border: hairline, tableLayout: 'fixed' }}>
                <thead>
                  <tr className="print-color-adjust" style={{ background: 'var(--color-accent-deep)' }}>
                    <th
                      className="font-condensed"
                      style={{ border: hairline, padding: '5px 6px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.16em', textAlign: 'left', color: '#fff' }}
                    >
                      Particulars
                    </th>
                    <th className="font-condensed" style={{ border: hairline, padding: '5px 6px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.16em', width: 50, color: '#fff' }}>
                      Qty.
                    </th>
                    <th className="font-condensed" style={{ border: hairline, padding: '5px 6px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.16em', width: 80, textAlign: 'right', color: '#fff' }}>
                      Rate
                    </th>
                    <th className="font-condensed" style={{ border: hairline, padding: '5px 6px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.16em', width: 90, textAlign: 'right', color: '#fff' }}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quotation.items.map((it, i) => (
                    <tr key={i}>
                      <td style={{ border: hairline, padding: '4px 6px', verticalAlign: 'top' }}>
                        <p>{it.particulars}</p>
                        {it.details && (
                          <div style={{ fontSize: 11, marginLeft: 8, marginTop: 2, whiteSpace: 'pre-wrap' }}>{it.details}</div>
                        )}
                      </td>
                      <td style={{ border: hairline, padding: '4px 6px', textAlign: 'center' }} className="tabular-nums">{it.qty}</td>
                      <td style={{ border: hairline, padding: '4px 6px', textAlign: 'right' }} className="tabular-nums">{formatINR(it.rate)}</td>
                      <td style={{ border: hairline, padding: '4px 6px', textAlign: 'right' }} className="tabular-nums">{formatINR(it.amount)}</td>
                    </tr>
                  ))}
                  {Array.from({ length: filler }).map((_, i) => (
                    <tr key={`filler-${i}`}>
                      <td style={{ border: hairline, padding: '3.4mm 6px' }}>&nbsp;</td>
                      <td style={{ border: hairline }}></td>
                      <td style={{ border: hairline }}></td>
                      <td style={{ border: hairline }}></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}

          {/* One bordered box continuing straight down from the table —
              border-top: none so it reads as the grid's own closing
              band, not a separate floating element. */}
          <div className="flex mb-4" style={{ border: '1px solid var(--color-accent-deep)', borderTop: 'none' }}>
            <div className="flex-1 p-3" style={{ borderRight: '1px solid var(--color-accent-deep)', minHeight: 90 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-accent-deep)' }}>DSA details &amp; signature</p>
              <p style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{quotation.notes}</p>
            </div>
            <div className="p-3" style={{ width: RIGHT_COL_WIDTH }}>
              <div className="flex justify-between pt-1">
                <span style={{ fontSize: 12 }}>Total</span>
                <span className="tabular-nums" style={{ fontSize: 12 }}>{formatINR(quotation.subtotal)}</span>
              </div>
              <div className="flex justify-between text-ink-2">
                <span style={{ fontSize: 12 }}>Discount</span>
                <span className="tabular-nums" style={{ fontSize: 12 }}>−{formatINR(quotation.discount)}</span>
              </div>
              <div
                className="flex justify-between font-condensed uppercase print-color-adjust"
                style={{ borderTop: '2px solid var(--color-accent)', background: 'var(--color-accent-tint)', marginTop: 4, padding: '4px 4px', fontWeight: 700, fontSize: 14 }}
              >
                <span>Grand total</span>
                <span className="tabular-nums">{formatINR(quotation.total)}</span>
              </div>
            </div>
          </div>

          {printMode === 'blank' &&
            (() => {
              const hairline = '1px solid var(--color-accent-deep)';
              const microLabel: React.CSSProperties = {
                fontSize: 11,
                letterSpacing: '0.12em',
                color: 'var(--color-accent-deep)',
                fontWeight: 600,
              };
              return (
                <div className="flex" style={{ border: hairline }}>
                  <div className="flex-1 flex flex-col" style={{ borderRight: hairline }}>
                    <div className="p-3" style={{ borderBottom: hairline }}>
                      <p className="font-condensed uppercase" style={microLabel}>Terms</p>
                      <ol style={{ fontSize: 13, marginTop: 6, listStyle: 'none', paddingLeft: 0 }}>
                        {(quotation.terms || '').split('\n').filter(Boolean).map((line, i) => (
                          <li key={i} style={{ marginTop: i > 0 ? 2 : 0 }}>
                            {i + 1}. {line}
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="flex flex-1">
                      <div className="flex-1 p-2" style={{ borderRight: hairline, minHeight: 60 }}>
                        <p className="font-condensed uppercase" style={microLabel}>{defaults.delivery_date_label}</p>
                      </div>
                      <div className="flex-1 p-2" style={{ minHeight: 60 }}>
                        <p className="font-condensed uppercase" style={microLabel}>Party&apos;s signature</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 flex flex-col justify-between" style={{ width: RIGHT_COL_WIDTH }}>
                    <p className="font-condensed uppercase text-right" style={{ fontSize: 17, letterSpacing: '0.08em', fontWeight: 700 }}>
                      For {defaults.business_name}
                    </p>
                    <p
                      className="font-condensed uppercase text-right text-ink-2"
                      style={{ fontSize: 10, letterSpacing: '0.12em' }}
                    >
                      {defaults.signatory_line}
                    </p>
                  </div>
                </div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
