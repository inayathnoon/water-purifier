'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import CustomerFields from '@/components/CustomerFields';
import { useSearchParams } from 'next/navigation';

interface Enquiry {
  id: string;
  enquiry_product_interest: string;
  enquiry_source: 'general' | 'water_test' | 'ready_to_buy' | 'referral' | null;
  call_count: number;
  created_at: string;
  customers: { name: string; phone_number: string; area: string };
}

const SOURCE_LABEL: Record<string, string> = {
  general: 'General enquiry',
  water_test: 'Brought water for testing',
  ready_to_buy: 'Ready to buy',
  referral: 'Referral',
};

const SOURCE_BADGE: Record<string, string> = {
  general: 'bg-gray-100 text-gray-900',
  water_test: 'bg-yellow-100 text-yellow-800',
  ready_to_buy: 'bg-green-100 text-green-800',
  referral: 'bg-blue-100 text-blue-800',
};

// Label on the left, the field on the right — placeholder text alone was
// too faint to read reliably, a real label always is.
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-40 shrink-0 text-sm font-medium text-gray-900">{label}</label>
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
    source: 'general' as 'general' | 'water_test' | 'ready_to_buy' | 'referral',
    referrerPhone: '',
    referrerName: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Autofill: a referrer's phone number that's referred before fills in
  // their name automatically, same as a repeat customer's number does.
  useEffect(() => {
    const phone = form.referrerPhone.trim();
    if (form.source !== 'referral' || phone.length < 6) return;
    const timeout = setTimeout(() => {
      fetch(`/api/admin/enquiries/referrer-lookup?phone=${encodeURIComponent(phone)}`)
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
    const res = await fetch('/api/admin/enquiries');
    const data = await res.json();
    setEnquiries(data.enquiries ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const daysOld = (createdAt: string) =>
    Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));

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
    });
    setShowForm(false);
    load();
  };

  const handleDelete = async (e: React.MouseEvent, enquiry: Enquiry) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete the enquiry for ${enquiry.customers?.name}? This removes it and its call history permanently — it cannot be undone.`
      )
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

  // Sort so anything ≥14 days old floats to the top (§5.6)
  const sorted = [...enquiries].sort((a, b) => daysOld(b.created_at) - daysOld(a.created_at));

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
        <h1 className="text-2xl font-bold">Enquiries</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ New Enquiry'}
        </button>
      </div>

      {error && !showForm && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white p-4 rounded-lg shadow mb-6 space-y-3">
          {error && <p className="text-red-600 text-sm">{error}</p>}
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
          <FormRow label="Interested in">
            <select
              className="w-full border rounded px-3 py-2 text-gray-900"
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
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value as typeof form.source })}
            >
              <option value="general">General enquiry</option>
              <option value="water_test">Brought water for testing</option>
              <option value="ready_to_buy">Ready to buy</option>
              <option value="referral">Referral</option>
            </select>
          </FormRow>
          {form.source === 'referral' && (
            <>
              <FormRow label="Referrer's phone">
                <input
                  required
                  className="w-full border rounded px-3 py-2 text-gray-900"
                  value={form.referrerPhone}
                  onChange={(e) => setForm({ ...form, referrerPhone: e.target.value })}
                />
              </FormRow>
              <FormRow label="Referrer's name">
                <input
                  required
                  className="w-full border rounded px-3 py-2 text-gray-900"
                  value={form.referrerName}
                  onChange={(e) => setForm({ ...form, referrerName: e.target.value })}
                />
              </FormRow>
              <p className="text-xs text-gray-600 -mt-2">
                A referrer's phone number that's referred before fills in their name automatically.
              </p>
            </>
          )}
          <p className="text-xs text-gray-900">
            Typing a phone number that already exists attaches this to that customer automatically.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="text-gray-900">No open enquiries.</p>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y">
          {sorted.map((e) => {
            const age = daysOld(e.created_at);
            return (
              <Link
                key={e.id}
                href={`/admin/enquiries/${e.id}`}
                className={`block p-4 hover:bg-gray-50 ${age >= 14 ? 'border-l-4 border-red-500' : ''}`}
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
                    <p className="text-sm text-gray-900">
                      {e.customers?.area} · {e.enquiry_product_interest || 'No product noted'}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className={age >= 14 ? 'text-red-600 font-semibold' : 'text-gray-900'}>
                      {age} day{age === 1 ? '' : 's'} old {age >= 14 ? '— decide now' : ''}
                    </p>
                    <p className="text-gray-900">{e.call_count} call(s) made</p>
                    <button
                      onClick={(ev) => handleDelete(ev, e)}
                      className="text-xs text-red-600 hover:underline mt-1"
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
  );
}
