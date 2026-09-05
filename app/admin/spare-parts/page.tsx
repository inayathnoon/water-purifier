'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import HomeLink from '@/components/HomeLink';

interface SparePart {
  name: string;
  price: number;
}

interface SparePartSale {
  id: string;
  part_name: string;
  unit_price: number;
  quantity: number;
  total: number;
  customer_name: string | null;
  phone_number: string | null;
  created_at: string;
  users: { name: string } | null;
}

// A "Service charges" row exists for use on an actual visit's Mark Done
// form — doesn't belong in a standalone retail sale, where no visit is
// happening at all.
function isServiceCharge(p: SparePart): boolean {
  return p.name.trim().toLowerCase().startsWith('service charge');
}

export default function SparePartsPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <SparePartsPageInner />
    </Suspense>
  );
}

function SparePartsPageInner() {
  // Dashboard's "+ Sell Spare Part" links here with ?new=1 to open the
  // sale form directly, same pattern as New Enquiry/Purchase/Service.
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [showSellForm, setShowSellForm] = useState(searchParams.get('new') === '1');
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [sellQuantities, setSellQuantities] = useState<Record<string, number>>({});
  const [sellCustomerName, setSellCustomerName] = useState('');
  const [sellPhoneNumber, setSellPhoneNumber] = useState('');
  const [sellError, setSellError] = useState('');
  const [submittingSell, setSubmittingSell] = useState(false);
  const [recentSales, setRecentSales] = useState<SparePartSale[]>([]);

  const load = async () => {
    setLoading(true);
    const [sparePartsRes, salesRes] = await Promise.all([
      fetch('/api/staff/spare-parts'),
      fetch('/api/admin/spare-part-sales'),
    ]);
    setSpareParts(((await sparePartsRes.json()).parts ?? []).filter((p: SparePart) => !isServiceCharge(p)));
    setRecentSales((await salesRes.json()).sales ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const adjustSellQty = (name: string, delta: number) => {
    setSellQuantities((prev) => ({ ...prev, [name]: Math.max(0, (prev[name] ?? 0) + delta) }));
  };

  const sellTotal = spareParts.reduce((sum, p) => sum + (sellQuantities[p.name] ?? 0) * p.price, 0);

  const handleSellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingSell) return;
    const items = spareParts
      .filter((p) => (sellQuantities[p.name] ?? 0) > 0)
      .map((p) => ({ partName: p.name, unitPrice: p.price, quantity: sellQuantities[p.name] }));
    if (items.length === 0) {
      setSellError('Pick at least one part.');
      return;
    }
    setSubmittingSell(true);
    setSellError('');
    const res = await fetch('/api/admin/spare-part-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customerName: sellCustomerName, phoneNumber: sellPhoneNumber }),
    });
    setSubmittingSell(false);
    if (!res.ok) {
      setSellError((await res.json()).error ?? 'Failed to record sale');
      return;
    }
    setSellQuantities({});
    setSellCustomerName('');
    setSellPhoneNumber('');
    setShowSellForm(false);
    load();
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <HomeLink />
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1 mt-2">
        <h1 className="text-2xl font-bold">Spare Parts</h1>
        <button
          onClick={() => setShowSellForm((s) => !s)}
          className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600"
        >
          {showSellForm ? 'Cancel' : '+ Sell Spare Part'}
        </button>
      </div>
      <p className="text-sm text-gray-900 mb-6">
        A part sold on its own at the office — no visit, no job, customer details optional.
      </p>

      {showSellForm && (
        <form onSubmit={handleSellSubmit} className="bg-white p-4 rounded-lg shadow mb-8 space-y-3">
          {sellError && <p className="text-red-600 text-sm">{sellError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Customer name (optional)"
              className="border rounded px-3 py-2 text-gray-900"
              value={sellCustomerName}
              onChange={(e) => setSellCustomerName(e.target.value.toUpperCase())}
            />
            <input
              placeholder="Phone number (optional)"
              className="border rounded px-3 py-2 text-gray-900"
              value={sellPhoneNumber}
              onChange={(e) => setSellPhoneNumber(e.target.value)}
            />
          </div>
          <div className="border rounded-lg divide-y">
            {spareParts.length === 0 ? (
              <p className="text-sm text-gray-900 p-3">No spare parts loaded — check the sheet.</p>
            ) : (
              spareParts.map((p) => (
                <div key={p.name} className="flex justify-between items-center p-3">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-gray-900">₹{p.price}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => adjustSellQty(p.name, -1)}
                      className="w-9 h-9 rounded-full border text-lg font-semibold active:bg-gray-100"
                    >
                      −
                    </button>
                    <span className="w-5 text-center">{sellQuantities[p.name] ?? 0}</span>
                    <button
                      type="button"
                      onClick={() => adjustSellQty(p.name, 1)}
                      className="w-9 h-9 rounded-full border text-lg font-semibold active:bg-gray-100"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-between items-center pt-2">
            <span className="font-medium">Total: ₹{sellTotal}</span>
            <button
              type="submit"
              disabled={submittingSell}
              className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50"
            >
              {submittingSell ? 'Recording...' : 'Record sale'}
            </button>
          </div>
        </form>
      )}

      <h2 className="text-lg font-semibold mb-2">Recent sales</h2>
      {loading ? (
        <p>Loading...</p>
      ) : recentSales.length === 0 ? (
        <p className="text-gray-900">No spare part sales yet.</p>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y">
          {recentSales.map((s) => (
            <div key={s.id} className="p-3 flex justify-between items-center text-sm">
              <div>
                <p className="font-medium">
                  {s.part_name} x{s.quantity}
                  {s.customer_name && <span className="text-gray-900 font-normal"> — {s.customer_name}</span>}
                </p>
                <p className="text-xs text-gray-900">
                  {new Date(s.created_at).toLocaleString()} · sold by {s.users?.name ?? 'Unknown'}
                </p>
              </div>
              <span className="font-medium">₹{s.total}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
