'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import AreaSelect from '@/components/AreaSelect';
import { daysAgoIST, todayIST } from '@/lib/dates';
import { toStartCase, formatINR } from '@/lib/format';
import { getCurrentUser, type User } from '@/lib/auth';

interface Order {
  id: string;
  ticket_id: string;
  status: string;
  list_price: number;
  sold_price: number;
  paid_amount: number;
  discount: number;
  balance_owed: number;
  last_payment_call_at: string | null;
  created_at: string;
  tickets: {
    status: string;
    customer_id: string;
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
  const [user, setUser] = useState<User | null>(null);
  // Voiding a purchase entered against the wrong customer or product —
  // only offered before any payment or visit, see cancelJob().
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  // Correcting a purchase's product/price — same unpaid/unvisited window
  // as voiding one, see updatePurchase().
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [purchaseEditForm, setPurchaseEditForm] = useState({
    productDetails: '', listPrice: '', soldPrice: '', billDate: '',
    customerId: '', customerPhone: '', customerName: '', customerAddress: '', customerArea: '',
    originalCustomerPhone: '',
  });
  const [purchaseEditError, setPurchaseEditError] = useState('');
  const [savingPurchaseEdit, setSavingPurchaseEdit] = useState(false);
  // Find a purchase by customer — phone number or name, filtered
  // client-side over what's already loaded (no separate search request).
  const [query, setQuery] = useState('');
  // Correcting the completion date/notes on an already-marked-done
  // installation — the replacement for the old technician-facing
  // mistake-fix window (editCompletedJob()).
  const [editingCompletionTicketId, setEditingCompletionTicketId] = useState<string | null>(null);
  const [completionEditForm, setCompletionEditForm] = useState({ actualDate: '', notes: '' });
  const [completionEditError, setCompletionEditError] = useState('');
  const [savingCompletionEdit, setSavingCompletionEdit] = useState(false);
  // Printing a single purchase's receipt — everything else on the page
  // (and the browser chrome) is hidden via the @media print rule below,
  // so only the one printable block for this order id shows up on paper.
  const [printingId, setPrintingId] = useState<string | null>(null);

  useEffect(() => {
    if (!printingId) return;
    // One tick so the printable block actually renders before the dialog
    // opens — printingId only just changed this same render.
    const t = setTimeout(() => window.print(), 50);
    return () => clearTimeout(t);
  }, [printingId]);

  useEffect(() => {
    const onAfterPrint = () => setPrintingId(null);
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, []);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/orders', { cache: 'no-store' });
    const data = await res.json();
    setOrders(data.orders ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    getCurrentUser().then(setUser);
  }, []);

  const daysSince = (d: string | null) => (d ? daysAgoIST(d) : Infinity);

  const q = query.trim().toLowerCase();
  const visibleOrders = q
    ? orders.filter(
        (o) =>
          o.tickets.customers.phone_number.toLowerCase().includes(q) ||
          o.tickets.customers.name.toLowerCase().includes(q)
      )
    : orders;

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

  const handleVoid = async (ticketId: string) => {
    if (voiding) return;
    if (!voidReason.trim()) {
      setError('A reason is required to void a purchase');
      return;
    }
    setVoiding(true);
    setError('');
    const res = await fetch(`/api/admin/tickets/${ticketId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: voidReason }),
    });
    setVoiding(false);
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setVoidingId(null);
    setVoidReason('');
    load();
  };

  const startEditingPurchase = (o: Order) => {
    setPurchaseEditError('');
    setEditingPurchaseId(o.ticket_id);
    setPurchaseEditForm({
      productDetails: productFields(o).name,
      listPrice: String(o.list_price),
      soldPrice: String(o.sold_price),
      billDate: billDate(o),
      customerId: o.tickets.customer_id,
      customerPhone: o.tickets.customers.phone_number,
      customerName: o.tickets.customers.name,
      customerAddress: o.tickets.customers.address,
      customerArea: o.tickets.customers.area,
      originalCustomerPhone: o.tickets.customers.phone_number,
    });
  };

  // Correcting the customer's own details (a typo'd phone/name/address,
  // not a wrong-customer mixup — that still goes through Void) reuses the
  // same updateCustomer() this customer already gets edited through on
  // the Customer Directory, including its phone-number sheet re-key.
  const handleSavePurchaseEdit = async (ticketId: string) => {
    if (savingPurchaseEdit) return;
    setSavingPurchaseEdit(true);
    setPurchaseEditError('');
    const customerRes = await fetch(`/api/admin/customers/${purchaseEditForm.customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: purchaseEditForm.customerPhone,
        name: purchaseEditForm.customerName,
        address: purchaseEditForm.customerAddress,
        area: purchaseEditForm.customerArea,
      }),
    });
    if (!customerRes.ok) {
      setSavingPurchaseEdit(false);
      setPurchaseEditError((await customerRes.json()).error ?? 'Failed to save customer details');
      return;
    }
    const res = await fetch(`/api/admin/installations/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productDetails: purchaseEditForm.productDetails,
        listPrice: Number(purchaseEditForm.listPrice),
        soldPrice: Number(purchaseEditForm.soldPrice),
        billDate: purchaseEditForm.billDate,
      }),
    });
    setSavingPurchaseEdit(false);
    if (!res.ok) {
      setPurchaseEditError((await res.json()).error ?? 'Failed to save');
      return;
    }
    setEditingPurchaseId(null);
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

  const startEditingCompletion = (ticket: Order['tickets'], ticketId: string) => {
    setCompletionEditError('');
    setEditingCompletionTicketId(ticketId);
    setCompletionEditForm({ actualDate: ticket.actual_date ?? todayIST(), notes: ticket.actual_notes ?? '' });
  };

  const handleSaveCompletionEdit = async (ticketId: string) => {
    if (savingCompletionEdit) return;
    setSavingCompletionEdit(true);
    setCompletionEditError('');
    const res = await fetch(`/api/admin/tickets/${ticketId}/edit-completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actualDate: completionEditForm.actualDate, notes: completionEditForm.notes }),
    });
    setSavingCompletionEdit(false);
    if (!res.ok) {
      setCompletionEditError((await res.json()).error ?? 'Failed to save');
      return;
    }
    setEditingCompletionTicketId(null);
    load();
  };

  const handleDownload = () => {
    const headers = [
      'Bill Date', 'Planned Installation Date', 'Installation Completed Date', 'Customer', 'Phone', 'Address', 'Area',
      'Brand', 'Name', 'Variant', 'SKU', 'Master SKU',
      'List Price', 'Sold Price', 'Discount', 'Paid', 'Balance Owed', 'Payment Status', 'Installation Status',
      'Warranty Expires',
    ];
    const rows = visibleOrders.map((o) => {
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
        o.balance_owed > 0 ? 'Pending' : 'Completed',
        o.tickets.installation_date ? 'Completed' : 'Pending',
        o.tickets.warranty_expires_at ?? '',
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM so Excel reads UTF-8 correctly
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orders.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell title="Purchases & payments">
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 mt-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {user?.role === 'owner' ? (
            <button
              onClick={handleDownload}
              disabled={visibleOrders.length === 0}
              className="px-3 py-1.5 bg-ok hover:opacity-90 text-white text-[13px] font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              Download Excel
            </button>
          ) : (
            <Link
              href="/admin/installations?new=1"
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              + New purchase
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="relative max-w-sm w-full">
          <input
            placeholder="Search customer — phone or name"
            className="w-full h-10 border border-rule rounded-xs pl-3 pr-8 text-[13px] focus-visible:outline-2 focus-visible:outline-accent"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2 text-[13px]"
            >
              ✕
            </button>
          )}
        </div>
        <span className="text-[13px] text-ink-2 tabular-nums shrink-0">
          {visibleOrders.length} purchase{visibleOrders.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && <p className="text-danger bg-danger-tint border-l-2 border-l-danger p-3 text-[13px] mb-4">{error}</p>}

      {loading ? (
        <p className="text-ink-2 text-[13px]">Loading…</p>
      ) : visibleOrders.length === 0 ? (
        <p className="text-ink-2 text-[13px] text-center py-8">{query ? `No purchases match "${query}".` : 'No purchases yet.'}</p>
      ) : (
        <div className="bg-surface border border-rule overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-inset text-left sticky top-14 z-10">
              <tr>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Bill date</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Completed</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Customer</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Brand</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Name</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Variant</th>
                <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Sold</th>
                <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Paid</th>
                <th className="p-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Balance</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Payment</th>
                <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Installation</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((o) => {
                const overdueCall = o.status === 'open' && daysSince(o.last_payment_call_at) >= 3;
                const isExpanded = expandedId === o.id;
                const p = productFields(o);
                return (
                  <Fragment key={o.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : o.id)}
                      style={{ height: 48 }}
                      className={`border-t border-divider cursor-pointer hover:bg-accent-tint ${overdueCall ? 'border-l-2 border-l-danger' : ''}`}
                    >
                      <td className="p-3 whitespace-nowrap tabular-nums">{billDate(o)}</td>
                      <td className="p-3 whitespace-nowrap tabular-nums">{o.tickets.installation_date ?? '—'}</td>
                      <td className="p-3">
                        <p className="font-semibold">{toStartCase(o.tickets.customers.name)}</p>
                        <p className="text-[12px] text-ink-2">{o.tickets.customers.phone_number}</p>
                      </td>
                      <td className="p-3 whitespace-nowrap">{p.brand || '—'}</td>
                      <td className="p-3 max-w-xs truncate">{p.name || '—'}</td>
                      <td className="p-3 whitespace-nowrap">{p.variant || '—'}</td>
                      <td className="p-3 text-right tabular-nums font-medium">{formatINR(o.sold_price)}</td>
                      <td className="p-3 text-right tabular-nums font-medium">{formatINR(o.paid_amount)}</td>
                      <td className="p-3 text-right tabular-nums font-semibold">
                        <span className={o.balance_owed > 0 ? 'text-danger' : 'text-ink'}>
                          {formatINR(o.balance_owed)}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`text-[11px] font-semibold uppercase tracking-[0.05em] px-1.5 py-0.5 ${o.balance_owed > 0 ? 'bg-danger-tint text-danger' : 'bg-ok-tint text-ok'}`}>
                          {o.balance_owed > 0 ? 'Pending' : 'Completed'}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {o.tickets.installation_date ? (
                          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] px-1.5 py-0.5 bg-ok-tint text-ok">Completed</span>
                        ) : (
                          <span className="text-ink-2">Pending</span>
                        )}
                      </td>
                      <td className="p-3 text-accent-deep whitespace-nowrap text-[12px] font-semibold">
                        <span className="inline-flex items-center gap-2">
                          {isExpanded ? 'Hide ▲' : 'Details ▼'}
                          <button
                            type="button"
                            title="Print this purchase"
                            aria-label="Print this purchase"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPrintingId(o.id);
                            }}
                            className="text-ink-2 hover:text-accent-deep p-0.5 -m-0.5"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 9 6 2 18 2 18 9" />
                              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                              <rect x="6" y="14" width="12" height="8" />
                            </svg>
                          </button>
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t bg-inset">
                        <td colSpan={12} className="p-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
                            <div>
                              <p className="text-ink-2 text-xs">Address</p>
                              <p>{o.tickets.customers.address}, {o.tickets.customers.area}</p>
                            </div>
                            <div>
                              <p className="text-ink-2 text-xs">Discount</p>
                              <p>{formatINR(o.discount)}</p>
                            </div>
                            {o.tickets.planned_installation_date && (
                              <div>
                                <p className="text-ink-2 text-xs">Planned installation</p>
                                <p>{o.tickets.planned_installation_date}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-ink-2 text-xs">Installation completed</p>
                              <p>{o.tickets.installation_date ?? '—'}</p>
                            </div>
                            <div>
                              <p className="text-ink-2 text-xs">Warranty until</p>
                              <p>{o.tickets.warranty_expires_at ?? '—'}</p>
                            </div>
                            {o.tickets.actual_notes && (
                              <div className="col-span-2 sm:col-span-4">
                                <p className="text-ink-2 text-xs">Notes</p>
                                <p>{o.tickets.actual_notes}</p>
                              </div>
                            )}
                          </div>

                          {o.tickets.actual_date && (
                            <div className="mb-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  editingCompletionTicketId === o.ticket_id
                                    ? setEditingCompletionTicketId(null)
                                    : startEditingCompletion(o.tickets, o.ticket_id);
                                }}
                                className="text-xs text-accent-deep hover:underline"
                              >
                                {editingCompletionTicketId === o.ticket_id ? 'Cancel edit' : 'Edit completion date/notes'}
                              </button>
                              {editingCompletionTicketId === o.ticket_id && (
                                <div onClick={(e) => e.stopPropagation()} className="mt-2 p-3 border rounded-md bg-surface space-y-2">
                                  {completionEditError && <p className="text-danger text-xs">{completionEditError}</p>}
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="text-xs text-ink-2">Completion date</label>
                                    <input
                                      type="date"
                                      max={todayIST()}
                                      value={completionEditForm.actualDate}
                                      onChange={(e) => setCompletionEditForm({ ...completionEditForm, actualDate: e.target.value })}
                                      className="border rounded px-2 py-1 text-sm"
                                    />
                                  </div>
                                  <textarea
                                    placeholder="Notes"
                                    value={completionEditForm.notes}
                                    onChange={(e) => setCompletionEditForm({ ...completionEditForm, notes: e.target.value })}
                                    className="w-full border rounded px-2 py-1.5 text-sm"
                                  />
                                  <p className="text-xs text-ink-2">
                                    Correcting the date also updates the warranty expiry, and re-syncs the Sales sheet.
                                  </p>
                                  <button
                                    onClick={() => handleSaveCompletionEdit(o.ticket_id)}
                                    disabled={savingCompletionEdit}
                                    className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm disabled:opacity-50"
                                  >
                                    {savingCompletionEdit ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {overdueCall && (
                            <p className="text-xs text-warn mb-2">
                              Overdue for a payment call (§7.3 — call every 3 days while owed)
                            </p>
                          )}

                          {o.status === 'open' && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); setCallingId(callingId === o.id ? null : o.id); }}
                                className="px-3 py-1.5 border rounded-md text-sm bg-surface"
                              >
                                Log call
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setPayingId(payingId === o.id ? null : o.id); }}
                                className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover"
                              >
                                Record payment
                              </button>
                              {o.balance_owed === 0 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleClose(o.id); }}
                                  className="px-3 py-1.5 bg-ok hover:opacity-90 text-white text-[13px] font-semibold"
                                >
                                  Close purchase
                                </button>
                              )}
                              {o.paid_amount === 0 && !o.tickets.actual_date && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setVoidingId(voidingId === o.ticket_id ? null : o.ticket_id);
                                    setVoidReason('');
                                    setError('');
                                  }}
                                  className="px-3 py-1.5 border border-danger text-danger rounded-md text-sm hover:bg-danger-tint"
                                >
                                  Void — wrong entry
                                </button>
                              )}
                            </div>
                          )}

                          {/* Available regardless of purchase/order status — a product,
                              price, or bill-date typo is worth fixing whether it's caught
                              same-day or found months later on an already-closed sale.
                              Raising/lowering sold price re-opens/re-closes the order to
                              match (see updatePurchase()) — Void stays the one thing still
                              gated to unpaid+unvisited, since undoing real money or real
                              completed work needs a human decision, not a plain edit. */}
                          <div className="flex flex-wrap gap-2 mt-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                editingPurchaseId === o.ticket_id ? setEditingPurchaseId(null) : startEditingPurchase(o);
                              }}
                              className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent-tint"
                            >
                              {editingPurchaseId === o.ticket_id ? 'Cancel edit' : 'Edit purchase details'}
                            </button>
                          </div>

                          {editingPurchaseId === o.ticket_id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t space-y-3">
                              {purchaseEditError && <p className="text-danger text-xs">{purchaseEditError}</p>}
                              <input
                                placeholder="Product details"
                                className="border rounded px-3 py-2 w-full bg-surface"
                                value={purchaseEditForm.productDetails}
                                onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, productDetails: e.target.value })}
                              />
                              <div className="flex gap-2">
                                <input
                                  type="date"
                                  required
                                  max={todayIST()}
                                  className="border rounded px-3 py-2 bg-surface"
                                  value={purchaseEditForm.billDate}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, billDate: e.target.value })}
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="List price"
                                  className="border rounded px-3 py-2 flex-1 bg-surface"
                                  value={purchaseEditForm.listPrice}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, listPrice: e.target.value })}
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="Sold price"
                                  className="border rounded px-3 py-2 flex-1 bg-surface"
                                  value={purchaseEditForm.soldPrice}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, soldPrice: e.target.value })}
                                />
                              </div>
                              {(() => {
                                const newSold = Number(purchaseEditForm.soldPrice);
                                if (!Number.isFinite(newSold)) return null;
                                const newBalance = newSold - o.paid_amount;
                                if (o.status === 'closed' && newBalance > 0) {
                                  return (
                                    <p className="text-xs text-warn">
                                      This reopens the purchase — ₹{newBalance.toFixed(2)} will show as owed again
                                      under Payments outstanding.
                                    </p>
                                  );
                                }
                                if (o.status === 'open' && newBalance <= 0) {
                                  return (
                                    <p className="text-xs text-ok">
                                      Nothing will be owed at this price — the purchase closes automatically.
                                    </p>
                                  );
                                }
                                return null;
                              })()}

                              <p className="text-xs text-ink-2 pt-1">Customer details</p>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  required
                                  placeholder="Phone number"
                                  className="border rounded px-3 py-2 bg-surface"
                                  value={purchaseEditForm.customerPhone}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, customerPhone: e.target.value })}
                                />
                                <input
                                  required
                                  placeholder="Name"
                                  className="border rounded px-3 py-2 bg-surface"
                                  value={purchaseEditForm.customerName}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, customerName: e.target.value.toUpperCase() })}
                                />
                                <input
                                  required
                                  placeholder="Address"
                                  className="border rounded px-3 py-2 bg-surface"
                                  value={purchaseEditForm.customerAddress}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, customerAddress: e.target.value })}
                                />
                                <AreaSelect
                                  required
                                  value={purchaseEditForm.customerArea}
                                  onChange={(area) => setPurchaseEditForm({ ...purchaseEditForm, customerArea: area })}
                                />
                              </div>
                              {purchaseEditForm.customerPhone.trim() !== purchaseEditForm.originalCustomerPhone && (
                                <p className="text-xs text-warn">
                                  Changing the phone number also renames this customer&apos;s existing Sales/Service/Enquiry
                                  sheet rows to match, so future syncs keep finding them.
                                </p>
                              )}

                              <button
                                onClick={() => handleSavePurchaseEdit(o.ticket_id)}
                                disabled={savingPurchaseEdit}
                                className="px-4 py-2 bg-accent text-white rounded-md disabled:opacity-50"
                              >
                                {savingPurchaseEdit ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          )}

                          {voidingId === o.ticket_id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t space-y-2">
                              <p className="text-xs text-ink-2">
                                Deletes this purchase and its Sales sheet row — for the wrong customer or wrong
                                product, caught before any payment or visit. Cannot be undone.
                              </p>
                              <div className="flex gap-2">
                                <input
                                  placeholder="Why is this being voided?"
                                  className="border rounded px-3 py-2 flex-1 bg-surface"
                                  value={voidReason}
                                  onChange={(e) => setVoidReason(e.target.value)}
                                />
                                <button
                                  onClick={() => handleVoid(o.ticket_id)}
                                  disabled={voiding}
                                  className="px-4 py-2 bg-danger hover:opacity-90 text-white text-[13px] font-semibold disabled:opacity-50"
                                >
                                  {voiding ? 'Voiding...' : 'Confirm void'}
                                </button>
                              </div>
                            </div>
                          )}

                          {payingId === o.id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t flex gap-2">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Amount"
                                className="border rounded px-3 py-2 flex-1 bg-surface"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                              />
                              <button onClick={() => handlePay(o.id)} className="px-4 py-2 bg-accent text-white rounded-md">
                                Submit
                              </button>
                            </div>
                          )}

                          {callingId === o.id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t flex gap-2">
                              <input
                                placeholder="What did they say?"
                                className="border rounded px-3 py-2 flex-1 bg-surface"
                                value={callNote}
                                onChange={(e) => setCallNote(e.target.value)}
                              />
                              <button onClick={() => handleCall(o.id)} className="px-4 py-2 bg-accent text-white rounded-md">
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

      {/* Only rendered while actually printing one purchase — a plain,
          unstyled receipt-shaped block. The @media print rule below
          hides everything else on the page (and the browser's own
          chrome around it isn't ours to hide, but every dashboard
          element under <body> is), so this is the only thing that
          reaches paper regardless of where it sits in the DOM. */}
      {printingId && (() => {
        const o = orders.find((x) => x.id === printingId);
        if (!o) return null;
        const p = productFields(o);
        return (
          <div className="print-receipt hidden">
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Noon Enterprises</h1>
            <p style={{ fontSize: 13, color: '#5d5d60', marginBottom: 16 }}>Purchase receipt</p>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Bill date</td><td style={{ padding: '4px 0' }}>{billDate(o)}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Customer</td><td style={{ padding: '4px 0' }}>{toStartCase(o.tickets.customers.name)} — {o.tickets.customers.phone_number}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Address</td><td style={{ padding: '4px 0' }}>{o.tickets.customers.address}, {o.tickets.customers.area}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Product</td><td style={{ padding: '4px 0' }}>{[p.brand, p.name, p.variant].filter(Boolean).join(' ') || '—'}{p.sku ? ` (${p.sku})` : ''}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>List price</td><td style={{ padding: '4px 0' }}>{formatINR(o.list_price)}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Discount</td><td style={{ padding: '4px 0' }}>{formatINR(o.discount)}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60', fontWeight: 600 }}>Sold price</td><td style={{ padding: '4px 0', fontWeight: 600 }}>{formatINR(o.sold_price)}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Paid</td><td style={{ padding: '4px 0' }}>{formatINR(o.paid_amount)}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Balance</td><td style={{ padding: '4px 0' }}>{formatINR(o.balance_owed)}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Installation completed</td><td style={{ padding: '4px 0' }}>{o.tickets.installation_date ?? '—'}</td></tr>
                <tr><td style={{ padding: '4px 8px 4px 0', color: '#5d5d60' }}>Warranty until</td><td style={{ padding: '4px 0' }}>{o.tickets.warranty_expires_at ?? '—'}</td></tr>
              </tbody>
            </table>
          </div>
        );
      })()}
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .print-receipt, .print-receipt * { visibility: visible; }
          .print-receipt { display: block !important; position: absolute; top: 0; left: 0; width: 100%; padding: 24px; }
        }
      `}</style>
    </div>
    </AppShell>
  );
}
