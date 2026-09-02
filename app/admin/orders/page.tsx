'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import HomeLink from '@/components/HomeLink';
import { daysAgoIST } from '@/lib/dates';
import { toStartCase } from '@/lib/format';

interface Order {
  id: string;
  status: string;
  list_price: number;
  sold_price: number;
  paid_amount: number;
  discount: number;
  balance_owed: number;
  last_payment_call_at: string | null;
  created_at: string;
  tickets: {
    planned_installation_date: string | null;
    actual_date: string | null;
    installation_date: string | null;
    warranty_expires_at: string | null;
    enquiry_product_interest: string | null;
    actual_notes: string | null;
    customers: { name: string; phone_number: string; address: string; area: string };
    products: { brand: string; name: string; variant: string | null; code: string; master_sku: string | null } | null;
  };
}

// Structured product columns come from the linked products row when the
// sale was made through ProductPicker; historical imports and free-text
// "Other" purchases never got a product_code, so only Name falls back to
// the old free-text field rather than showing every column blank.
// Brand/Name come from the sheet in ALL CAPS — Start Case matches how
// free-text product descriptions already read everywhere else in the app.
function productFields(o: Order) {
  const p = o.tickets.products;
  return {
    brand: p?.brand ? toStartCase(p.brand) : '',
    name: p?.name ? toStartCase(p.name) : (o.tickets.enquiry_product_interest ?? ''),
    variant: p?.variant ?? '',
    sku: p?.code ?? '',
    masterSku: p?.master_sku ?? '',
  };
}

// Two genuinely different dates: Bill Date is when the sale itself was
// recorded (order.created_at — backfilled to the real historical date
// for imported records, not left at the day the import script ran), and
// Installation Completed is the warranty-start date (installation_date —
// stamped from the tech's actual_date, but only once the order is
// actually closed, §8.1) — for a live sale these can be days or weeks apart.
function billDate(o: Order): string {
  return o.created_at.slice(0, 10);
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [callingId, setCallingId] = useState<string | null>(null);
  const [callNote, setCallNote] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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

  const daysSince = (d: string | null) => (d ? daysAgoIST(d) : Infinity);

  const filtered = useMemo(
    () =>
      orders.filter((o) => {
        const d = billDate(o);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      }),
    [orders, dateFrom, dateTo]
  );

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

  const handleDownload = () => {
    const headers = [
      'Bill Date', 'Planned Installation Date', 'Installation Completed Date', 'Customer', 'Phone', 'Address', 'Area',
      'Brand', 'Name', 'Variant', 'SKU', 'Master SKU',
      'List Price', 'Sold Price', 'Discount', 'Paid', 'Balance Owed', 'Status', 'Warranty Expires',
    ];
    const rows = filtered.map((o) => {
      const p = productFields(o);
      return [
        billDate(o),
        o.tickets.planned_installation_date ?? '',
        o.tickets.installation_date ?? '',
        o.tickets.customers.name,
        o.tickets.customers.phone_number,
        o.tickets.customers.address,
        o.tickets.customers.area,
        p.brand,
        p.name,
        p.variant,
        p.sku,
        p.masterSku,
        o.list_price,
        o.sold_price,
        o.discount,
        o.paid_amount,
        o.balance_owed,
        o.status,
        o.tickets.warranty_expires_at ?? '',
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM so Excel reads UTF-8 correctly
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const suffix = dateFrom || dateTo ? `_${dateFrom || 'start'}_to_${dateTo || 'end'}` : '';
    a.href = url;
    a.download = `orders${suffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <HomeLink />
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 mt-2">
        <h1 className="text-2xl font-bold">Orders & Payments</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-gray-900">From</label>
          <input type="date" className="border rounded px-2 py-1" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <label className="text-gray-900">To</label>
          <input type="date" className="border rounded px-2 py-1" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-blue-600 hover:underline">
              Clear
            </button>
          )}
          <button
            onClick={handleDownload}
            disabled={filtered.length === 0}
            className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            Download Excel
          </button>
        </div>
      </div>
      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-900">No orders {orders.length > 0 ? 'in this date range.' : 'yet.'}</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Bill Date</th>
                <th className="p-3">Completed</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Brand</th>
                <th className="p-3">Name</th>
                <th className="p-3">Variant</th>
                <th className="p-3 text-right">Sold</th>
                <th className="p-3 text-right">Paid</th>
                <th className="p-3 text-right">Balance</th>
                <th className="p-3">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const overdueCall = o.status === 'open' && daysSince(o.last_payment_call_at) >= 3;
                const isExpanded = expandedId === o.id;
                const p = productFields(o);
                return (
                  <Fragment key={o.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : o.id)}
                      className={`border-t cursor-pointer hover:bg-gray-50 ${overdueCall ? 'border-l-4 border-orange-500' : ''}`}
                    >
                      <td className="p-3 whitespace-nowrap">{billDate(o)}</td>
                      <td className="p-3 whitespace-nowrap">{o.tickets.installation_date ?? '—'}</td>
                      <td className="p-3">
                        <p className="font-medium">{o.tickets.customers.name}</p>
                        <p className="text-xs text-gray-600">{o.tickets.customers.phone_number}</p>
                      </td>
                      <td className="p-3 whitespace-nowrap">{p.brand || '—'}</td>
                      <td className="p-3 max-w-xs truncate">{p.name || '—'}</td>
                      <td className="p-3 whitespace-nowrap">{p.variant || '—'}</td>
                      <td className="p-3 text-right">₹{o.sold_price}</td>
                      <td className="p-3 text-right">₹{o.paid_amount}</td>
                      <td className="p-3 text-right">
                        <span className={o.balance_owed > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
                          ₹{o.balance_owed}
                        </span>
                      </td>
                      <td className="p-3 capitalize">{o.status}</td>
                      <td className="p-3 text-blue-600 whitespace-nowrap">{isExpanded ? 'Hide ▲' : 'Details ▼'}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t bg-gray-50">
                        <td colSpan={11} className="p-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
                            <div>
                              <p className="text-gray-600 text-xs">Address</p>
                              <p>{o.tickets.customers.address}, {o.tickets.customers.area}</p>
                            </div>
                            <div>
                              <p className="text-gray-600 text-xs">Discount</p>
                              <p>₹{o.discount}</p>
                            </div>
                            {o.tickets.planned_installation_date && (
                              <div>
                                <p className="text-gray-600 text-xs">Planned installation</p>
                                <p>{o.tickets.planned_installation_date}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-gray-600 text-xs">Installation completed</p>
                              <p>{o.tickets.installation_date ?? '—'}</p>
                            </div>
                            <div>
                              <p className="text-gray-600 text-xs">Warranty until</p>
                              <p>{o.tickets.warranty_expires_at ?? '—'}</p>
                            </div>
                            {o.tickets.actual_notes && (
                              <div className="col-span-2 sm:col-span-4">
                                <p className="text-gray-600 text-xs">Notes</p>
                                <p>{o.tickets.actual_notes}</p>
                              </div>
                            )}
                          </div>

                          {overdueCall && (
                            <p className="text-xs text-orange-600 mb-2">
                              Overdue for a payment call (§7.3 — call every 3 days while owed)
                            </p>
                          )}

                          {o.status === 'open' && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); setCallingId(callingId === o.id ? null : o.id); }}
                                className="px-3 py-1.5 border rounded-md text-sm bg-white"
                              >
                                Log call
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setPayingId(payingId === o.id ? null : o.id); }}
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                              >
                                Record payment
                              </button>
                              {o.balance_owed === 0 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleClose(o.id); }}
                                  className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                                >
                                  Close order
                                </button>
                              )}
                            </div>
                          )}

                          {payingId === o.id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t flex gap-2">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Amount"
                                className="border rounded px-3 py-2 flex-1 bg-white"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                              />
                              <button onClick={() => handlePay(o.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md">
                                Submit
                              </button>
                            </div>
                          )}

                          {callingId === o.id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t flex gap-2">
                              <input
                                placeholder="What did they say?"
                                className="border rounded px-3 py-2 flex-1 bg-white"
                                value={callNote}
                                onChange={(e) => setCallNote(e.target.value)}
                              />
                              <button onClick={() => handleCall(o.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md">
                                Log
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
