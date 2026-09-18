'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import CustomerFields from '@/components/CustomerFields';
import AppShell from '@/components/AppShell';
import { useConfirm } from '@/components/useConfirm';
import { daysAgoIST, enquiryUrgency, todayIST } from '@/lib/dates';
import { useSearchParams } from 'next/navigation';

interface Enquiry {
  id: string;
  enquiry_product_interest: string;
  enquiry_source: 'general' | 'water_test' | 'ready_to_buy' | 'referral' | 'other' | null;
  call_count: number;
  created_at: string;
  last_call_at: string | null;
  customers: { name: string; phone_number: string; area: string };
}

const SOURCE_LABEL: Record<string, string> = {
  general: 'General enquiry',
  water_test: 'Brought water for testing',
  ready_to_buy: 'Ready to buy',
  referral: 'Referral',
  other: 'Other',
};

const SOURCE_BADGE: Record<string, string> = {
  general: 'bg-inset text-ink',
  water_test: 'bg-warn-tint text-warn',
  ready_to_buy: 'bg-ok-tint text-ok',
  referral: 'bg-accent-tint text-accent-deep',
  other: 'bg-inset text-ink-2',
};

// Label on the left, the field on the right — placeholder text alone was
// too faint to read reliably, a real label always is.
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-40 shrink-0 text-sm font-medium text-ink">{label}</label>
      {children}
    </div>
  );
}

export default function EnquiriesPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <EnquiriesPageInner />
    </Suspense>
  );
}

function EnquiriesPageInner() {
  // "+ New Enquiry" on the dashboard links here with ?new=1 so it opens
  // straight to the form instead of the list.
  const searchParams = useSearchParams();
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [form, setForm] = useState({
    phoneNumber: '',
    name: '',
    address: '',
    area: '',
    customerId: null as string | null,
    forceNewAddress: false,
    productInterest: '',
    source: 'general' as 'general' | 'water_test' | 'ready_to_buy' | 'referral' | 'other',
    referrerPhone: '',
    referrerName: '',
    sourceOtherNote: '',
    enquiryDate: todayIST(),
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  // Autofill: a referrer's phone number that's referred before fills in
  // their name automatically, same as a repeat customer's number does.
  useEffect(() => {
    const phone = form.referrerPhone.trim();
    if (form.source !== 'referral' || phone.length < 6) return;
    const timeout = setTimeout(() => {
      fetch(`/api/admin/enquiries/referrer-lookup?phone=${encodeURIComponent(phone)}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          if (data.referrerName) setForm((f) => ({ ...f, referrerName: data.referrerName }));
        });
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.referrerPhone, form.source]);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/enquiries', { cache: 'no-store' });
    const data = await res.json();
    setEnquiries(data.enquiries ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const daysOld = daysAgoIST;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // a fast double-click on Create must never create two enquiries
    setSubmitting(true);
    setError('');
    const res = await fetch('/api/admin/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Failed to create enquiry');
      return;
    }
    setForm({
      phoneNumber: '',
      name: '',
      address: '',
      area: '',
      customerId: null,
      forceNewAddress: false,
      productInterest: '',
      source: 'general',
      referrerPhone: '',
      referrerName: '',
      sourceOtherNote: '',
      enquiryDate: todayIST(),
    });
    setShowForm(false);
    load();
  };

  const handleDelete = async (e: React.MouseEvent, enquiry: Enquiry) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !(await confirm(
        `Delete the enquiry for ${enquiry.customers?.name}? This removes it and its call history permanently — it cannot be undone.`
      ))
    ) {
      return;
    }
    const res = await fetch(`/api/admin/enquiries/${enquiry.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Failed to delete enquiry');
      return;
    }
    load();
  };

  // Newest first — the admin dashboard's own "New Enquiries" card is
  // still oldest-first for flagging (§5.6/§15.4); this list is for
  // finding a specific enquiry, where the most recent one is usually
  // the one just created. A 14+ day old enquiry still gets its red-flag
  // border wherever it lands, just no longer pinned to the top here.
  const sorted = [...enquiries].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <AppShell title="Enquiries">
    <div className="max-w-5xl mx-auto">
      {confirmDialog}
      <div className="flex flex-wrap justify-between items-center gap-2 mb-6 mt-2">
        <button
          onClick={() => setShowForm((s) => !s)}
          className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover"
        >
          {showForm ? 'Cancel' : '+ New Enquiry'}
        </button>
      </div>

      {error && !showForm && <p className="text-danger bg-danger-tint p-3 rounded mb-4">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface p-4 rounded-lg shadow-sm border border-rule mb-6 space-y-3">
          {error && <p className="text-danger text-sm">{error}</p>}
          <CustomerFields
            value={{
              phoneNumber: form.phoneNumber,
              name: form.name,
              address: form.address,
              area: form.area,
              customerId: form.customerId,
              forceNewAddress: form.forceNewAddress,
            }}
            onChange={(v) => setForm({ ...form, ...v })}
          />
          <FormRow label="Date">
            <input
              required
              type="date"
              max={todayIST()}
              className="w-full border rounded px-3 py-2 text-ink"
              value={form.enquiryDate}
              onChange={(e) => setForm({ ...form, enquiryDate: e.target.value })}
            />
          </FormRow>
          <FormRow label="Interested in">
            <select
              className="w-full border rounded px-3 py-2 text-ink"
              value={form.productInterest}
              onChange={(e) => setForm({ ...form, productInterest: e.target.value })}
            >
              <option value="">(optional — not decided yet)</option>
              <option value="Kitchen">Kitchen</option>
              <option value="Vessel">Vessel</option>
              <option value="Commercial">Commercial</option>
            </select>
          </FormRow>
          <FormRow label="How did this come in?">
            <select
              className="w-full border rounded px-3 py-2 text-ink"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value as typeof form.source })}
            >
              <option value="general">General enquiry</option>
              <option value="water_test">Brought water for testing</option>
              <option value="ready_to_buy">Ready to buy</option>
              <option value="referral">Referral</option>
              <option value="other">Other</option>
            </select>
          </FormRow>
          {form.source === 'referral' && (
            <>
              <FormRow label="Referrer's phone">
                <input
                  required
                  className="w-full border rounded px-3 py-2 text-ink"
                  value={form.referrerPhone}
                  onChange={(e) => setForm({ ...form, referrerPhone: e.target.value })}
                />
              </FormRow>
              <FormRow label="Referrer's name">
                <input
                  required
                  className="w-full border rounded px-3 py-2 text-ink"
                  value={form.referrerName}
                  onChange={(e) => setForm({ ...form, referrerName: e.target.value })}
                />
              </FormRow>
              <p className="text-xs text-ink-2 -mt-2">
                A referrer's phone number that's referred before fills in their name automatically.
              </p>
            </>
          )}
          {form.source === 'other' && (
            <FormRow label="Please specify">
              <input
                required
                placeholder="How did this enquiry come in?"
                className="w-full border rounded px-3 py-2 text-ink"
                value={form.sourceOtherNote}
                onChange={(e) => setForm({ ...form, sourceOtherNote: e.target.value })}
              />
            </FormRow>
          )}
          <p className="text-xs text-ink-2">
            Typing a phone number that already exists attaches this to that customer automatically.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="text-ink">No open enquiries.</p>
      ) : (
        <div className="bg-surface rounded-lg shadow-sm border border-rule divide-y">
          {sorted.map((e) => {
            const age = daysOld(e.created_at);
            // §5.6 revised — urgency tracks days since the last real
            // activity (a call, or creation if never called): 3+ days
            // yellow, 14+ days red. A call resets the clock either way.
            const urgency = enquiryUrgency(e.created_at, e.last_call_at);
            const borderClass =
              urgency === 'red' ? 'border-l-4 border-red-500' : urgency === 'yellow' ? 'border-l-4 border-warn' : '';
            const textClass =
              urgency === 'red' ? 'text-danger font-semibold' : urgency === 'yellow' ? 'text-warn font-medium' : 'text-ink';
            return (
              <Link
                key={e.id}
                href={`/admin/enquiries/${e.id}`}
                className={`block p-4 hover:bg-accent-tint ${borderClass}`}
              >
                <div className="flex justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {e.customers?.name} — {e.customers?.phone_number}
                      </p>
                      {e.enquiry_source && e.enquiry_source !== 'general' && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${SOURCE_BADGE[e.enquiry_source]}`}>
                          {SOURCE_LABEL[e.enquiry_source]}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-ink-2">
                      {e.customers?.area} · {e.enquiry_product_interest || 'No product noted'}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    {e.last_call_at ? (
                      <p className={textClass}>
                        Last called {daysOld(e.last_call_at)} day{daysOld(e.last_call_at) === 1 ? '' : 's'} ago
                      </p>
                    ) : (
                      <p className={textClass}>
                        {age} day{age === 1 ? '' : 's'} old {urgency === 'red' ? '— decide now' : ''}
                      </p>
                    )}
                    <p className="text-ink">{e.call_count} call(s) made</p>
                    <button
                      onClick={(ev) => handleDelete(ev, e)}
                      className="text-xs text-danger hover:underline mt-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
    </AppShell>
  );
}
