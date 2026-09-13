'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AreaSelect from '@/components/AreaSelect';
import { todayIST } from '@/lib/dates';
import { toStartCase, formatINR } from '@/lib/format';

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
  payment_history: { amount: number; date: string }[];
}

interface CallLogEntry {
  id: string;
  note: string;
  created_at: string;
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
  call_log: CallLogEntry[];
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
  enquiry: 'bg-accent-tint text-accent-deep',
  installation: 'bg-ok-tint text-ok',
  service_visit: 'bg-warn-tint text-warn',
};

export default function CustomerDirectoryPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <CustomerDirectoryPageInner />
    </Suspense>
  );
}

function CustomerDirectoryPageInner() {
  // The dashboard's "Payments outstanding" list links here with
  // ?phone=... so clicking a name goes straight to their orders instead
  // of landing on an empty search box.
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('phone') ?? '');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, Ticket[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [error, setError] = useState('');
  // §4.1: correcting a customer's own details, chief among them a
  // typo'd phone number — the primary lookup key everywhere.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ phoneNumber: '', name: '', address: '', area: '' });
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  // Recording a payment right from a customer's history — same action
  // as Purchases' own "Record payment", just reachable from wherever
  // "money owed" actually gets clicked through from.
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', date: todayIST() });
  const [paymentError, setPaymentError] = useState('');
  const [payingSubmitting, setPayingSubmitting] = useState(false);
  // Logging a payment-reminder call (§7.3) right from here too — same
  // endpoint /admin/orders' own "Log call" already uses.
  const [callingOrderId, setCallingOrderId] = useState<string | null>(null);
  const [callNote, setCallNote] = useState('');
  const [callError, setCallError] = useState('');
  const [callSubmitting, setCallSubmitting] = useState(false);

  const runSearch = async (e?: React.FormEvent, overrideQuery?: string) => {
    e?.preventDefault();
    const q = overrideQuery ?? query;
    if (!q.trim()) return;
    setSearching(true);
    setError('');
    const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(q.trim())}`);
    const data = await res.json();
    const customers: Customer[] = data.customers ?? [];
    setResults(customers);
    setSearching(false);
    setSearched(true);
    setExpandedId(null);
    return customers;
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

  const startPayment = (orderId: string) => {
    setPaymentError('');
    setPayingOrderId(orderId);
    setPaymentForm({ amount: '', date: todayIST() });
  };

  const handleRecordPayment = async (e: React.FormEvent, orderId: string, customerId: string) => {
    e.preventDefault();
    if (payingSubmitting) return;
    setPayingSubmitting(true);
    setPaymentError('');
    const res = await fetch(`/api/admin/orders/${orderId}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(paymentForm.amount), paymentDate: paymentForm.date }),
    });
    setPayingSubmitting(false);
    if (!res.ok) {
      setPaymentError((await res.json()).error ?? 'Failed to record payment');
      return;
    }
    setPayingOrderId(null);
    // Refresh this customer's history so the new balance/payment shows
    // immediately, same data this whole panel is already built from.
    const historyRes = await fetch(`/api/admin/customers/${customerId}`);
    const data = await historyRes.json();
    if (historyRes.ok) setHistory((h) => ({ ...h, [customerId]: data.tickets ?? [] }));
  };

  const startCall = (orderId: string) => {
    setCallError('');
    setCallingOrderId(orderId);
    setCallNote('');
  };

  const handleLogCall = async (e: React.FormEvent, orderId: string, customerId: string) => {
    e.preventDefault();
    if (callSubmitting) return;
    setCallSubmitting(true);
    setCallError('');
    const res = await fetch(`/api/admin/orders/${orderId}/payment-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: callNote }),
    });
    setCallSubmitting(false);
    if (!res.ok) {
      setCallError((await res.json()).error ?? 'Failed to log call');
      return;
    }
    setCallingOrderId(null);
    const historyRes = await fetch(`/api/admin/customers/${customerId}`);
    const data = await historyRes.json();
    if (historyRes.ok) setHistory((h) => ({ ...h, [customerId]: data.tickets ?? [] }));
  };

  const startEditing = (c: Customer) => {
    setEditError('');
    setEditingId(c.id);
    setEditForm({ phoneNumber: c.phone_number, name: c.name, address: c.address, area: c.area });
  };

  const handleSaveEdit = async (e: React.FormEvent, customerId: string) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setEditError('');
    const res = await fetch(`/api/admin/customers/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setSaving(false);
    if (!res.ok) {
      setEditError((await res.json()).error ?? 'Failed to save');
      return;
    }
    const { customer } = await res.json();
    setResults((rs) => rs.map((r) => (r.id === customerId ? customer : r)));
    setEditingId(null);
  };

  // Arriving via ?phone=... — search automatically and open the first
  // match's history right away, rather than making it a two-step process.
  useEffect(() => {
    const phone = searchParams.get('phone');
    if (!phone) return;
    runSearch(undefined, phone).then((customers) => {
      if (customers && customers.length > 0) toggleExpand(customers[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell title="Customers">
    <div className="max-w-4xl mx-auto">
      <p className="text-sm text-ink-2 mb-4">
        Search by phone number or name to see everything a customer has enquired about or bought.
      </p>

      <form onSubmit={runSearch} className="flex gap-2 mb-6">
        <input
          autoFocus
          placeholder="Phone number or name"
          className="flex-1 border rounded px-3 py-2 text-ink"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="text-danger bg-danger-tint p-3 rounded mb-4">{error}</p>}

      {searched && results.length === 0 && !searching && (
        <p className="text-ink">No customers match &quot;{query}&quot;.</p>
      )}

      {results.length > 0 && (
        <div className="bg-surface rounded-lg shadow-sm border border-rule divide-y">
          {results.map((c) => {
            const isExpanded = expandedId === c.id;
            const tickets = history[c.id];
            return (
              <div key={c.id}>
                <div className="w-full p-4 hover:bg-accent-tint flex justify-between items-center gap-2">
                  <button onClick={() => toggleExpand(c)} className="flex-1 text-left">
                    <p className="font-semibold text-[15px]">{toStartCase(c.name)}</p>
                    <p className="text-[13px] text-ink-2">
                      {c.phone_number} · {c.address}, {c.area}
                    </p>
                  </button>
                  <button
                    onClick={() => (editingId === c.id ? setEditingId(null) : startEditing(c))}
                    className="text-sm text-ink-2 hover:underline whitespace-nowrap"
                  >
                    {editingId === c.id ? 'Cancel' : 'Edit'}
                  </button>
                  <button onClick={() => toggleExpand(c)} className="text-accent-deep text-sm whitespace-nowrap">
                    {isExpanded ? 'Hide ▲' : 'History ▼'}
                  </button>
                </div>

                {editingId === c.id && (
                  <form onSubmit={(e) => handleSaveEdit(e, c.id)} className="bg-accent-tint border-t border-b p-4 space-y-2">
                    {editError && <p className="text-danger text-sm">{editError}</p>}
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        required
                        placeholder="Phone number"
                        className="border rounded px-3 py-2 text-ink"
                        value={editForm.phoneNumber}
                        onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                      />
                      <input
                        required
                        placeholder="Name"
                        className="border rounded px-3 py-2 text-ink"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value.toUpperCase() })}
                      />
                      <input
                        required
                        placeholder="Address"
                        className="border rounded px-3 py-2 text-ink"
                        value={editForm.address}
                        onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                      />
                      <AreaSelect
                        required
                        value={editForm.area}
                        onChange={(area) => setEditForm({ ...editForm, area })}
                      />
                    </div>
                    {editForm.phoneNumber.trim() !== c.phone_number && (
                      <p className="text-xs text-warn">
                        Changing the phone number also renames this customer&apos;s existing Sales/Service/Enquiry
                        sheet rows to match, so future syncs keep finding them.
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save changes'}
                    </button>
                  </form>
                )}

                {isExpanded && (
                  <div className="bg-inset border-t p-4">
                    {loadingHistory === c.id ? (
                      <p className="text-sm text-ink-2">Loading...</p>
                    ) : !tickets || tickets.length === 0 ? (
                      <p className="text-sm text-ink-2">No enquiries or purchases on record.</p>
                    ) : (
                      <div className="space-y-2">
                        {tickets.map((t) => {
                          const order = firstOrder(t.orders);
                          return (
                            <div key={t.id} className="bg-surface rounded border p-3 text-sm">
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${KIND_BADGE[t.kind]}`}>
                                    {KIND_LABEL[t.kind]}
                                  </span>
                                  <span className="ml-2 text-ink-2 capitalize">{t.status}</span>
                                </div>
                                <span className="text-xs text-ink-2 whitespace-nowrap">
                                  {(t.actual_date ?? t.created_at.slice(0, 10))}
                                </span>
                              </div>
                              {t.enquiry_product_interest && (
                                <p className="mt-1 text-ink">{t.enquiry_product_interest}</p>
                              )}
                              {t.kind === 'installation' && t.agreed_price != null && (
                                <p className="mt-1 text-ink">Agreed price: {formatINR(t.agreed_price)}</p>
                              )}
                              {t.kind === 'service_visit' && t.charge_amount != null && (
                                <p className="mt-1 text-ink">
                                  Charge: {t.charge_amount === 0 ? 'Free (under warranty)' : formatINR(t.charge_amount)}
                                </p>
                              )}
                              {order && (
                                <>
                                  <p className="mt-1 text-ink-2 tabular-nums">
                                    List {formatINR(order.list_price)} · Sold {formatINR(order.sold_price)} · Discount {formatINR(order.discount)} · Paid {formatINR(order.paid_amount)} ·{' '}
                                    <span className={order.balance_owed > 0 ? 'text-danger font-semibold' : 'text-ok font-semibold'}>
                                      Balance {formatINR(order.balance_owed)}
                                    </span>
                                    {order.balance_owed > 0 && (
                                      <>
                                        <button
                                          onClick={() => (payingOrderId === order.id ? setPayingOrderId(null) : startPayment(order.id))}
                                          className="ml-2 text-accent-deep hover:underline"
                                        >
                                          {payingOrderId === order.id ? 'Cancel' : 'Record payment'}
                                        </button>
                                        <button
                                          onClick={() => (callingOrderId === order.id ? setCallingOrderId(null) : startCall(order.id))}
                                          className="ml-2 text-accent-deep hover:underline"
                                        >
                                          {callingOrderId === order.id ? 'Cancel' : 'Log call'}
                                        </button>
                                      </>
                                    )}
                                  </p>
                                  {order.payment_history?.length > 0 && (
                                    <div className="mt-1 text-xs text-ink-2 tabular-nums">
                                      Payments:{' '}
                                      {order.payment_history
                                        .map((p) => `${formatINR(p.amount)} on ${p.date.slice(0, 10)}`)
                                        .join(', ')}
                                    </div>
                                  )}
                                  {t.call_log?.length > 0 && (
                                    <div className="mt-1 text-xs text-ink-2">
                                      Calls (newest first):
                                      <ul className="mt-0.5 space-y-0.5">
                                        {t.call_log.map((call) => (
                                          <li key={call.id}>
                                            {new Date(call.created_at).toLocaleDateString()} — {call.note}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {callingOrderId === order.id && (
                                    <form
                                      onSubmit={(e) => handleLogCall(e, order.id, c.id)}
                                      className="mt-2 pt-2 border-t flex flex-wrap gap-2 items-start"
                                    >
                                      {callError && <p className="w-full text-danger text-xs">{callError}</p>}
                                      <input
                                        required
                                        placeholder="What did they say?"
                                        className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[10rem]"
                                        value={callNote}
                                        onChange={(e) => setCallNote(e.target.value)}
                                      />
                                      <button
                                        type="submit"
                                        disabled={callSubmitting}
                                        className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover disabled:opacity-50"
                                      >
                                        {callSubmitting ? 'Saving...' : 'Save'}
                                      </button>
                                    </form>
                                  )}
                                  {payingOrderId === order.id && (
                                    <form
                                      onSubmit={(e) => handleRecordPayment(e, order.id, c.id)}
                                      className="mt-2 pt-2 border-t flex flex-wrap gap-2 items-start"
                                    >
                                      {paymentError && <p className="w-full text-danger text-xs">{paymentError}</p>}
                                      <input
                                        type="date"
                                        required
                                        max={todayIST()}
                                        className="border rounded px-2 py-1.5 text-sm"
                                        value={paymentForm.date}
                                        onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                                      />
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        max={order.balance_owed}
                                        required
                                        placeholder="Amount"
                                        className="border rounded px-2 py-1.5 text-sm w-28"
                                        value={paymentForm.amount}
                                        onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                                      />
                                      <button
                                        type="submit"
                                        disabled={payingSubmitting}
                                        className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover disabled:opacity-50"
                                      >
                                        {payingSubmitting ? 'Saving...' : 'Save'}
                                      </button>
                                    </form>
                                  )}
                                </>
                              )}
                              {t.enquiry_source && t.enquiry_source !== 'general' && (
                                <p className="mt-1 text-xs text-ink-2 capitalize">Source: {t.enquiry_source.replace('_', ' ')}</p>
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
    </AppShell>
  );
}
