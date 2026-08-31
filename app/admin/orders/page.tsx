'use client';

import { useEffect, useState } from 'react';

interface Order {
  id: string;
  status: string;
  list_price: number;
  sold_price: number;
  paid_amount: number;
  discount: number;
  balance_owed: number;
  last_payment_call_at: string | null;
  tickets: { customers: { name: string; phone_number: string } };
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [callingId, setCallingId] = useState<string | null>(null);
  const [callNote, setCallNote] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/orders');
    const data = await res.json();
    setOrders(data.orders ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const daysSince = (d: string | null) =>
    d ? Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24)) : Infinity;

  const handlePay = async (orderId: string) => {
    setError('');
    const res = await fetch(`/api/admin/orders/${orderId}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(amount) }),
    });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setPayingId(null);
    setAmount('');
    load();
  };

  const handleCall = async (orderId: string) => {
    setError('');
    const res = await fetch(`/api/admin/orders/${orderId}/payment-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: callNote }),
    });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setCallingId(null);
    setCallNote('');
    load();
  };

  const handleClose = async (orderId: string) => {
    setError('');
    const res = await fetch(`/api/admin/orders/${orderId}/close`, { method: 'POST' });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    load();
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-6">Orders & Payments</h1>
      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : orders.length === 0 ? (
        <p className="text-gray-600">No orders yet.</p>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => {
            const overdueCall = o.status === 'open' && daysSince(o.last_payment_call_at) >= 3;
            return (
              <div
                key={o.id}
                className={`bg-white rounded-lg shadow p-4 ${overdueCall ? 'border-l-4 border-orange-500' : ''}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">
                      {o.tickets.customers.name} — {o.tickets.customers.phone_number}
                    </p>
                    <p className="text-sm text-gray-600">
                      List: ${o.list_price} · Sold: ${o.sold_price} · Discount: ${o.discount}
                    </p>
                    <p className="text-sm mt-1">
                      Paid: ${o.paid_amount} ·{' '}
                      <span className={o.balance_owed > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
                        Balance owed: ${o.balance_owed}
                      </span>
                      {' · '}
                      <span className="capitalize">{o.status}</span>
                    </p>
                    {overdueCall && (
                      <p className="text-xs text-orange-600 mt-1">
                        Overdue for a payment call (§7.3 — call every 3 days while owed)
                      </p>
                    )}
                  </div>

                  {o.status === 'open' && (
                    <div className="space-x-2">
                      <button
                        onClick={() => setCallingId(callingId === o.id ? null : o.id)}
                        className="px-3 py-1.5 border rounded-md text-sm"
                      >
                        Log call
                      </button>
                      <button
                        onClick={() => setPayingId(payingId === o.id ? null : o.id)}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                      >
                        Record payment
                      </button>
                      {o.balance_owed === 0 && (
                        <button
                          onClick={() => handleClose(o.id)}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                        >
                          Close order
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {payingId === o.id && (
                  <div className="mt-3 pt-3 border-t flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount"
                      className="border rounded px-3 py-2 flex-1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <button onClick={() => handlePay(o.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md">
                      Submit
                    </button>
                  </div>
                )}

                {callingId === o.id && (
                  <div className="mt-3 pt-3 border-t flex gap-2">
                    <input
                      placeholder="What did they say?"
                      className="border rounded px-3 py-2 flex-1"
                      value={callNote}
                      onChange={(e) => setCallNote(e.target.value)}
                    />
                    <button onClick={() => handleCall(o.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md">
                      Log
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
