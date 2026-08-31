'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface Enquiry {
  id: string;
  enquiry_product_interest: string;
  call_count: number;
  created_at: string;
  customers: { name: string; phone_number: string; area: string };
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
  const [form, setForm] = useState({ phoneNumber: '', name: '', address: '', area: '', productInterest: '' });
  const [error, setError] = useState('');

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
    setError('');
    const res = await fetch('/api/admin/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Failed to create enquiry');
      return;
    }
    setForm({ phoneNumber: '', name: '', address: '', area: '', productInterest: '' });
    setShowForm(false);
    load();
  };

  // Sort so anything ≥14 days old floats to the top (§5.6)
  const sorted = [...enquiries].sort((a, b) => daysOld(b.created_at) - daysOld(a.created_at));

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Enquiries</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ New Enquiry'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white p-4 rounded-lg shadow mb-6 space-y-3">
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <input
            required
            placeholder="Phone number"
            className="w-full border rounded px-3 py-2"
            value={form.phoneNumber}
            onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
          />
          <input
            required
            placeholder="Name"
            className="w-full border rounded px-3 py-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            required
            placeholder="Address"
            className="w-full border rounded px-3 py-2"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <input
            required
            placeholder="Area"
            className="w-full border rounded px-3 py-2"
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
          />
          <input
            placeholder="What are they interested in?"
            className="w-full border rounded px-3 py-2"
            value={form.productInterest}
            onChange={(e) => setForm({ ...form, productInterest: e.target.value })}
          />
          <p className="text-xs text-gray-500">
            Typing a phone number that already exists attaches this to that customer automatically.
          </p>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Create
          </button>
        </form>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="text-gray-500">No open enquiries.</p>
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
                    <p className="font-medium">
                      {e.customers?.name} — {e.customers?.phone_number}
                    </p>
                    <p className="text-sm text-gray-600">
                      {e.customers?.area} · {e.enquiry_product_interest || 'No product noted'}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className={age >= 14 ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                      {age} day{age === 1 ? '' : 's'} old {age >= 14 ? '— decide now' : ''}
                    </p>
                    <p className="text-gray-400">{e.call_count} call(s) made</p>
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
