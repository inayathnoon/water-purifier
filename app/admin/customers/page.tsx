'use client';

import { useState } from 'react';
import HomeLink from '@/components/HomeLink';

interface Customer {
  id: string;
  name: string;
  phone_number: string;
  address: string;
  area: string;
}

interface Order {
  id: string;
  status: string;
  list_price: number;
  sold_price: number;
  paid_amount: number;
  discount: number;
  balance_owed: number;
}

interface Ticket {
  id: string;
  kind: 'enquiry' | 'installation' | 'service_visit';
  status: string;
  created_at: string;
  actual_date: string | null;
  enquiry_product_interest: string | null;
  enquiry_source: string | null;
  closure_reason: string | null;
  agreed_price: number | null;
  charge_amount: number | null;
  orders: Order | Order[] | null;
}

function firstOrder(orders: Ticket['orders']): Order | null {
  if (!orders) return null;
  return Array.isArray(orders) ? (orders[0] ?? null) : orders;
}

const KIND_LABEL: Record<string, string> = {
  enquiry: 'Enquiry',
  installation: 'Purchase',
  service_visit: 'Service visit',
};

const KIND_BADGE: Record<string, string> = {
  enquiry: 'bg-blue-100 text-blue-800',
  installation: 'bg-green-100 text-green-800',
  service_visit: 'bg-yellow-100 text-yellow-800',
};

export default function CustomerDirectoryPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, Ticket[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [error, setError] = useState('');

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(query.trim())}`);
    const data = await res.json();
    setResults(data.customers ?? []);
    setSearching(false);
    setSearched(true);
    setExpandedId(null);
  };

  const toggleExpand = async (customer: Customer) => {
    if (expandedId === customer.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(customer.id);
    if (!history[customer.id]) {
      setLoadingHistory(customer.id);
      const res = await fetch(`/api/admin/customers/${customer.id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to load history');
      } else {
        setHistory((h) => ({ ...h, [customer.id]: data.tickets ?? [] }));
      }
      setLoadingHistory(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <HomeLink />
      <h1 className="text-2xl font-bold mb-1 mt-2">Customer Directory</h1>
      <p className="text-sm text-gray-900 mb-4">
        Search by phone number or name to see everything a customer has enquired about or bought.
      </p>

      <form onSubmit={runSearch} className="flex gap-2 mb-6">
        <input
          autoFocus
          placeholder="Phone number or name"
          className="flex-1 border rounded px-3 py-2 text-gray-900"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {searched && results.length === 0 && !searching && (
        <p className="text-gray-900">No customers match &quot;{query}&quot;.</p>
      )}

      {results.length > 0 && (
        <div className="bg-white rounded-lg shadow divide-y">
          {results.map((c) => {
            const isExpanded = expandedId === c.id;
            const tickets = history[c.id];
            return (
              <div key={c.id}>
                <button
                  onClick={() => toggleExpand(c)}
                  className="w-full text-left p-4 hover:bg-gray-50 flex justify-between items-center"
                >
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-gray-600">
                      {c.phone_number} · {c.address}, {c.area}
                    </p>
                  </div>
                  <span className="text-blue-600 text-sm">{isExpanded ? 'Hide ▲' : 'History ▼'}</span>
                </button>

                {isExpanded && (
                  <div className="bg-gray-50 border-t p-4">
                    {loadingHistory === c.id ? (
                      <p className="text-sm text-gray-600">Loading...</p>
                    ) : !tickets || tickets.length === 0 ? (
                      <p className="text-sm text-gray-600">No enquiries or purchases on record.</p>
                    ) : (
                      <div className="space-y-2">
                        {tickets.map((t) => {
                          const order = firstOrder(t.orders);
                          return (
                            <div key={t.id} className="bg-white rounded border p-3 text-sm">
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${KIND_BADGE[t.kind]}`}>
                                    {KIND_LABEL[t.kind]}
                                  </span>
                                  <span className="ml-2 text-gray-600 capitalize">{t.status}</span>
                                </div>
                                <span className="text-xs text-gray-600 whitespace-nowrap">
                                  {(t.actual_date ?? t.created_at.slice(0, 10))}
                                </span>
                              </div>
                              {t.enquiry_product_interest && (
                                <p className="mt-1 text-gray-900">{t.enquiry_product_interest}</p>
                              )}
                              {t.kind === 'installation' && t.agreed_price != null && (
                                <p className="mt-1 text-gray-900">Agreed price: ₹{t.agreed_price}</p>
                              )}
                              {t.kind === 'service_visit' && t.charge_amount != null && (
                                <p className="mt-1 text-gray-900">
                                  Charge: {t.charge_amount === 0 ? 'Free (under warranty)' : `₹${t.charge_amount}`}
                                </p>
                              )}
                              {order && (
                                <p className="mt-1 text-gray-600">
                                  List ₹{order.list_price} · Sold ₹{order.sold_price} · Discount ₹{order.discount} · Paid ₹
                                  {order.paid_amount} ·{' '}
                                  <span className={order.balance_owed > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                                    Balance ₹{order.balance_owed}
                                  </span>
                                </p>
                              )}
                              {t.enquiry_source && t.enquiry_source !== 'general' && (
                                <p className="mt-1 text-xs text-gray-600 capitalize">Source: {t.enquiry_source.replace('_', ' ')}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
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
