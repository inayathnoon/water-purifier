'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CustomerFields, { type CustomerFieldsValue } from './CustomerFields';
import ProductPicker from './ProductPicker';
import { todayIST } from '@/lib/dates';
import { toStartCase, formatINR } from '@/lib/format';

interface Item {
  key: number;
  particulars: string;
  details: string;
  qty: string;
  rate: string;
  productCode: string | null;
}

function emptyItem(key: number): Item {
  return { key, particulars: '', details: '', qty: '1', rate: '', productCode: null };
}

function emptyCustomer(): CustomerFieldsValue {
  return { phoneNumber: '', name: '', address: '', area: '', customerId: null, forceNewAddress: false };
}

// 11px uppercase micro-label heading, used above every section — the
// form's own vocabulary for "here's a new group of fields" instead of a
// bordered box per section.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 mb-2">{children}</p>;
}

const fieldClass =
  'block w-full h-11 px-3 border border-rule rounded-xs text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 text-[14px]';

/**
 * One form for both /admin/quotations?new=1 and /admin/quotations/[id]?edit=1
 * — quotationId undefined means "new" (blank, defaults prefilled from
 * quotation_defaults); given means "edit" (prefilled from the existing row).
 */
export default function QuotationForm({ quotationId, duplicateFromId }: { quotationId?: string; duplicateFromId?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(!!quotationId);
  const [customer, setCustomer] = useState<CustomerFieldsValue>(emptyCustomer());
  const [customerEmail, setCustomerEmail] = useState('');
  const [quoteDate, setQuoteDate] = useState(todayIST());
  const [quoteNo, setQuoteNo] = useState<number | null>(null);
  const [quotePrefix, setQuotePrefix] = useState('Q');
  const [items, setItems] = useState<Item[]>([emptyItem(0), emptyItem(1)]);
  const [nextKey, setNextKey] = useState(2);
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState('');
  const [showHeaderTerms, setShowHeaderTerms] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [terms, setTerms] = useState('');
  const [deliveryDateLabel, setDeliveryDateLabel] = useState('');
  const [signatoryLine, setSignatoryLine] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const defaultsRes = await fetch('/api/admin/quotation-defaults');
      const { defaults } = await defaultsRes.json();
      setQuotePrefix(defaults.quote_prefix);
      setBusinessName(defaults.business_name);
      setAddress(defaults.address);
      setPhone(defaults.phone);
      setMobile(defaults.mobile);
      setEmail(defaults.email);
      setTerms(defaults.terms);
      setDeliveryDateLabel(defaults.delivery_date_label);
      setSignatoryLine(defaults.signatory_line);

      if (quotationId) {
        const res = await fetch(`/api/admin/quotations/${quotationId}`);
        const { quotation: q } = await res.json();
        setCustomer({
          phoneNumber: q.phone_number ?? '',
          name: q.customer_name ?? '',
          address: q.address ?? '',
          area: q.area ?? '',
          customerId: q.customer_id,
          forceNewAddress: false,
        });
        setQuoteDate(q.quote_date);
        setQuoteNo(q.quote_no);
        setCustomerEmail(q.email ?? '');
        setNotes(q.notes ?? '');
        setDiscount(q.discount ? String(q.discount) : '');
        setTerms(q.terms ?? defaults.terms);
        // Items are the one thing never pulled from defaults — always
        // exactly what this quotation itself already has.
        setItems(
          (q.items ?? []).map((it: { particulars: string; details: string | null; qty: number; rate: number; product_code: string | null }, i: number) => ({
            key: i,
            particulars: it.particulars,
            details: it.details ?? '',
            qty: String(it.qty),
            rate: String(it.rate),
            productCode: it.product_code,
          }))
        );
        setNextKey((q.items ?? []).length);
      } else if (duplicateFromId) {
        // "Duplicate" — reuses the tedious part (a full item list already
        // typed up: particulars, details, rates) for a repeat quote to a
        // *different* customer, so customer/date/discount/number all
        // still start blank/fresh exactly like any other new quotation.
        const res = await fetch(`/api/admin/quotations/${duplicateFromId}`);
        const { quotation: q } = await res.json();
        setNotes(q.notes ?? defaults.notes);
        setTerms(q.terms ?? defaults.terms);
        setItems(
          (q.items ?? []).map((it: { particulars: string; details: string | null; qty: number; rate: number; product_code: string | null }, i: number) => ({
            key: i,
            particulars: it.particulars,
            details: it.details ?? '',
            qty: String(it.qty),
            rate: String(it.rate),
            productCode: it.product_code,
          }))
        );
        setNextKey((q.items ?? []).length);
      } else {
        // Fresh quotation — notes seeded from the remembered default
        // (§6), everything else (items, customer, date, discount) blank.
        setNotes(defaults.notes);
      }
      setLoading(false);
    })();
  }, [quotationId, duplicateFromId]);

  const updateItem = (key: number, patch: Partial<Item>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeItem = (key: number) => setItems((rows) => rows.filter((r) => r.key !== key));
  const addItem = () => {
    setItems((rows) => [...rows, emptyItem(nextKey)]);
    setNextKey((n) => n + 1);
  };

  const amountFor = (it: Item) => (Number(it.qty) || 0) * (Number(it.rate) || 0);
  const subtotal = items.reduce((sum, it) => sum + amountFor(it), 0);
  const discountAmount = Math.max(0, Number(discount) || 0);
  const grandTotal = Math.max(0, subtotal - discountAmount);
  const discountTooLarge = discountAmount > subtotal;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (items.every((it) => !it.particulars.trim())) {
      setError('At least one item is required');
      return;
    }
    setSubmitting(true);

    const payload = {
      customerId: customer.customerId,
      customerName: customer.name,
      phoneNumber: customer.phoneNumber,
      email: customerEmail || null,
      address: customer.address,
      area: customer.area,
      quoteDate,
      notes,
      terms,
      discount: discountAmount,
      items: items
        .filter((it) => it.particulars.trim())
        .map((it) => ({
          particulars: it.particulars,
          details: it.details || null,
          qty: Number(it.qty) || 1,
          rate: Number(it.rate) || 0,
          productCode: it.productCode,
        })),
    };

    const res = quotationId
      ? await fetch(`/api/admin/quotations/${quotationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/admin/quotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

    if (!res.ok) {
      setSubmitting(false);
      setError((await res.json()).error ?? 'Failed to save');
      return;
    }
    const { quotation } = await res.json();

    // Whatever was just saved becomes the default for the *next*
    // quotation — never retroactive on this or any other saved row
    // (each row already stores its own terms/notes copy above).
    fetch('/api/admin/quotation-defaults', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName, address, phone, mobile, email, notes, terms, deliveryDateLabel, signatoryLine, quotePrefix }),
    }).catch(() => {});

    router.push(`/admin/quotations/${quotation.id}`);
  };

  if (loading) return <p className="text-ink-2 text-[13px] p-6">Loading…</p>;

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <h1 className="font-condensed text-[22px] uppercase tracking-[0.04em] mb-4">
        {quotationId ? 'Edit quotation' : 'New quotation'}
      </h1>
      <form onSubmit={handleSubmit} className="bg-surface border border-rule p-5 space-y-6">
        {error && <p className="text-danger text-[13px]">{error}</p>}

        <div>
          <SectionLabel>Customer</SectionLabel>
          <div className="space-y-3">
            <CustomerFields value={customer} onChange={setCustomer} preserveCase />
            <div>
              <label className="block text-[13px] font-medium text-ink mb-1">Email (optional)</label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="For sending the quotation by email"
                className={fieldClass}
              />
            </div>
          </div>
        </div>

        <div className="border-t border-rule pt-4 flex gap-4">
          <div className="flex-1">
            <SectionLabel>Date</SectionLabel>
            <input
              type="date"
              required
              max={todayIST()}
              value={quoteDate}
              onChange={(e) => setQuoteDate(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="flex-1">
            <SectionLabel>No.</SectionLabel>
            <p className="h-11 flex items-center text-ink-2 text-[14px]">
              {quoteNo ? `${quotePrefix}-${String(quoteNo).padStart(3, '0')}` : 'Assigned on save'}
            </p>
          </div>
        </div>

        <div className="border-t border-rule pt-4">
          <SectionLabel>Items</SectionLabel>
          <div className="space-y-4">
            {items.map((it) => (
              <div key={it.key} className="border border-rule p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <ProductPicker
                      onChange={(v) => {
                        if (v) updateItem(it.key, { particulars: toStartCase(v.display), productCode: v.code });
                      }}
                    />
                    <input
                      placeholder="Or type particulars not in the product sheet"
                      value={it.particulars}
                      onChange={(e) => updateItem(it.key, { particulars: e.target.value, productCode: null })}
                      className={fieldClass}
                    />
                    <textarea
                      placeholder="Details (optional — indented sub-lines, e.g. 1) Multi media filter... 2) Iron remover...)"
                      value={it.details}
                      onChange={(e) => updateItem(it.key, { details: e.target.value })}
                      rows={2}
                      className="w-full border border-rule rounded-xs px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-accent"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(it.key)}
                    aria-label="Remove item"
                    className="text-ink-2 hover:text-danger px-2 h-11"
                  >
                    ×
                  </button>
                </div>
                <div className="flex gap-2 justify-end text-[13px] tabular-nums">
                  <label className="flex items-center gap-1">
                    Qty
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.qty}
                      onChange={(e) => updateItem(it.key, { qty: e.target.value })}
                      className="w-16 h-9 border border-rule rounded-xs px-2 text-right"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Rate
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.rate}
                      onChange={(e) => updateItem(it.key, { rate: e.target.value })}
                      className="w-24 h-9 border border-rule rounded-xs px-2 text-right"
                    />
                  </label>
                  <span className="flex items-center gap-1 text-ink-2">
                    Amount <span className="font-medium text-ink w-24 text-right inline-block">{formatINR(amountFor(it))}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addItem} className="mt-3 text-[13px] text-accent-deep hover:underline">
            + Add item
          </button>
        </div>

        <div className="border-t border-rule pt-4">
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full border border-rule rounded-xs px-3 py-2 text-[14px] focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>

        <div className="border-t border-rule pt-4">
          <SectionLabel>Totals</SectionLabel>
          <div className="max-w-xs ml-auto space-y-1 text-[14px]">
            <div className="flex justify-between border-t border-rule pt-2">
              <span className="text-ink-2">Total</span>
              <span className="tabular-nums">{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-ink-2">Discount</span>
              <span className="flex items-center gap-1">
                <span className="text-ink-2">−₹</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-24 h-9 border border-rule rounded-xs px-2 text-right tabular-nums"
                />
              </span>
            </div>
            {discountTooLarge && <p className="text-danger text-[12px] text-right">Discount is larger than the total</p>}
            <div className="flex justify-between border-t-2 border-accent pt-2 font-semibold">
              <span>Grand total</span>
              <span className="tabular-nums">{formatINR(grandTotal)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-rule pt-4">
          <button
            type="button"
            onClick={() => setShowHeaderTerms((s) => !s)}
            className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 hover:text-ink"
          >
            {showHeaderTerms ? '▾' : '▸'} Header &amp; terms
          </button>
          {showHeaderTerms && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>Business name</SectionLabel>
                <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={fieldClass} />
              </div>
              <div>
                <SectionLabel>Quote prefix</SectionLabel>
                <input value={quotePrefix} onChange={(e) => setQuotePrefix(e.target.value)} className={fieldClass} />
              </div>
              <div className="col-span-2">
                <SectionLabel>Address</SectionLabel>
                <input value={address} onChange={(e) => setAddress(e.target.value)} className={fieldClass} />
              </div>
              <div>
                <SectionLabel>Phone</SectionLabel>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
              </div>
              <div>
                <SectionLabel>Mobile</SectionLabel>
                <input value={mobile} onChange={(e) => setMobile(e.target.value)} className={fieldClass} />
              </div>
              <div className="col-span-2">
                <SectionLabel>Email</SectionLabel>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
              </div>
              <div className="col-span-2">
                <SectionLabel>Terms (one per line)</SectionLabel>
                <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className="w-full border border-rule rounded-xs px-3 py-2 text-[13px]" />
              </div>
              <div>
                <SectionLabel>Delivery date label</SectionLabel>
                <input value={deliveryDateLabel} onChange={(e) => setDeliveryDateLabel(e.target.value)} className={fieldClass} />
              </div>
              <div>
                <SectionLabel>Signatory line</SectionLabel>
                <input value={signatoryLine} onChange={(e) => setSignatoryLine(e.target.value)} className={fieldClass} />
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-rule pt-4 flex justify-end gap-3">
          <button type="button" onClick={() => router.push(quotationId ? `/admin/quotations/${quotationId}` : '/admin/quotations')} className="text-[13px] text-ink-2 hover:underline">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save quotation'}
          </button>
        </div>
      </form>
    </div>
  );
}
