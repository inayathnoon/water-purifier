'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import HomeLink from '@/components/HomeLink';
import AreaSelect from '@/components/AreaSelect';
import { daysAgoIST, todayIST } from '@/lib/dates';
import { toStartCase } from '@/lib/format';
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
  confirmation_status: 'pending' | 'completed';
  confirmation_note: string | null;
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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [satisfactionNoteFor, setSatisfactionNoteFor] = useState<string | null>(null);
  const [satisfactionNote, setSatisfactionNote] = useState('');
  const [confirmingSatisfaction, setConfirmingSatisfaction] = useState(false);
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

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/orders');
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

  // The tech has already marked the job done (ticket.status === 'completed');
  // this is the admin's confirmation call — closing it stamps
  // installation_date (from the tech's own actual_date, §8.1) and starts
  // the warranty clock. Installation status on this page is read straight
  // off whether installation_date is set, so this is what flips it.
  const handleConfirmInstallation = async (ticketId: string) => {
    setError('');
    setConfirmingId(ticketId);
    const res = await fetch(`/api/admin/tickets/${ticketId}/close`, { method: 'POST' });
    setConfirmingId(null);
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    load();
  };

  // A separate follow-up satisfaction call, made sometime after the
  // installation is already confirmed — needs its own short note, not
  // just a click (mirrors §5.4/§5.5's word-count rule for enquiries).
  const handleConfirmSatisfaction = async (orderId: string) => {
    if (confirmingSatisfaction) return;
    setError('');
    setConfirmingSatisfaction(true);
    const res = await fetch(`/api/admin/orders/${orderId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: satisfactionNote }),
    });
    setConfirmingSatisfaction(false);
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setSatisfactionNoteFor(null);
    setSatisfactionNote('');
    load();
  };

  const handleDownload = () => {
    const headers = [
      'Bill Date', 'Planned Installation Date', 'Installation Completed Date', 'Customer', 'Phone', 'Address', 'Area',
      'Brand', 'Name', 'Variant', 'SKU', 'Master SKU',
      'List Price', 'Sold Price', 'Discount', 'Paid', 'Balance Owed', 'Payment Status', 'Installation Status',
      'Follow-up Call Status', 'Follow-up Call Note', 'Warranty Expires',
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
        o.confirmation_status === 'completed' ? 'Completed' : 'Pending',
        o.confirmation_note ?? '',
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
    <div className="max-w-6xl mx-auto py-8 px-4">
      <HomeLink />
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 mt-2">
        <h1 className="text-2xl font-bold">Purchases & Payments</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {user?.role === 'owner' ? (
            <button
              onClick={handleDownload}
              disabled={visibleOrders.length === 0}
              className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              Download Excel
            </button>
          ) : (
            <Link
              href="/admin/installations?new=1"
              className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              + New Purchase
            </Link>
          )}
        </div>
      </div>

      <div className="relative mb-4 max-w-sm">
        <input
          placeholder="Find a customer — phone number or name"
          className="w-full border rounded px-3 py-2 text-gray-900"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : visibleOrders.length === 0 ? (
        <p className="text-gray-900">{query ? `No purchases match "${query}".` : 'No purchases yet.'}</p>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
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
                <th className="p-3">Payment</th>
                <th className="p-3">Installation</th>
                <th className="p-3">Follow-up</th>
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
                      <td className="p-3 whitespace-nowrap">
                        <span className={o.balance_owed > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                          {o.balance_owed > 0 ? 'Pending' : 'Completed'}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {o.tickets.installation_date ? (
                          <span className="text-green-600">Completed</span>
                        ) : o.tickets.status === 'completed' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleConfirmInstallation(o.ticket_id); }}
                            disabled={confirmingId === o.ticket_id}
                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            {confirmingId === o.ticket_id ? 'Confirming...' : 'Confirm date'}
                          </button>
                        ) : (
                          <span className="text-gray-600">Pending</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {o.confirmation_status === 'completed' ? (
                          <span className="text-green-600">Completed</span>
                        ) : (
                          <span className="text-gray-600">Pending</span>
                        )}
                      </td>
                      <td className="p-3 text-blue-600 whitespace-nowrap">{isExpanded ? 'Hide ▲' : 'Details ▼'}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t bg-gray-50">
                        <td colSpan={13} className="p-4">
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
                            {o.confirmation_status === 'completed' && o.confirmation_note && (
                              <div className="col-span-2 sm:col-span-4">
                                <p className="text-gray-600 text-xs">Follow-up call</p>
                                <p>{o.confirmation_note}</p>
                              </div>
                            )}
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
                                  Close purchase
                                </button>
                              )}
                              {o.paid_amount === 0 && !o.tickets.actual_date && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      editingPurchaseId === o.ticket_id ? setEditingPurchaseId(null) : startEditingPurchase(o);
                                    }}
                                    className="px-3 py-1.5 border rounded-md text-sm hover:bg-gray-50"
                                  >
                                    {editingPurchaseId === o.ticket_id ? 'Cancel edit' : 'Edit'}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setVoidingId(voidingId === o.ticket_id ? null : o.ticket_id);
                                      setVoidReason('');
                                      setError('');
                                    }}
                                    className="px-3 py-1.5 border border-red-300 text-red-700 rounded-md text-sm hover:bg-red-50"
                                  >
                                    Void — wrong entry
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {editingPurchaseId === o.ticket_id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t space-y-3">
                              {purchaseEditError && <p className="text-red-600 text-xs">{purchaseEditError}</p>}
                              <input
                                placeholder="Product details"
                                className="border rounded px-3 py-2 w-full bg-white"
                                value={purchaseEditForm.productDetails}
                                onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, productDetails: e.target.value })}
                              />
                              <div className="flex gap-2">
                                <input
                                  type="date"
                                  required
                                  max={todayIST()}
                                  className="border rounded px-3 py-2 bg-white"
                                  value={purchaseEditForm.billDate}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, billDate: e.target.value })}
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="List price"
                                  className="border rounded px-3 py-2 flex-1 bg-white"
                                  value={purchaseEditForm.listPrice}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, listPrice: e.target.value })}
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="Sold price"
                                  className="border rounded px-3 py-2 flex-1 bg-white"
                                  value={purchaseEditForm.soldPrice}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, soldPrice: e.target.value })}
                                />
                              </div>

                              <p className="text-xs text-gray-600 pt-1">Customer details</p>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  required
                                  placeholder="Phone number"
                                  className="border rounded px-3 py-2 bg-white"
                                  value={purchaseEditForm.customerPhone}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, customerPhone: e.target.value })}
                                />
                                <input
                                  required
                                  placeholder="Name"
                                  className="border rounded px-3 py-2 bg-white"
                                  value={purchaseEditForm.customerName}
                                  onChange={(e) => setPurchaseEditForm({ ...purchaseEditForm, customerName: e.target.value.toUpperCase() })}
                                />
                                <input
                                  required
                                  placeholder="Address"
                                  className="border rounded px-3 py-2 bg-white"
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
                                <p className="text-xs text-orange-700">
                                  Changing the phone number also renames this customer&apos;s existing Sales/Service/Enquiry
                                  sheet rows to match, so future syncs keep finding them.
                                </p>
                              )}

                              <button
                                onClick={() => handleSavePurchaseEdit(o.ticket_id)}
                                disabled={savingPurchaseEdit}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50"
                              >
                                {savingPurchaseEdit ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          )}

                          {voidingId === o.ticket_id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t space-y-2">
                              <p className="text-xs text-gray-600">
                                Deletes this purchase and its Sales sheet row — for the wrong customer or wrong
                                product, caught before any payment or visit. Cannot be undone.
                              </p>
                              <div className="flex gap-2">
                                <input
                                  placeholder="Why is this being voided?"
                                  className="border rounded px-3 py-2 flex-1 bg-white"
                                  value={voidReason}
                                  onChange={(e) => setVoidReason(e.target.value)}
                                />
                                <button
                                  onClick={() => handleVoid(o.ticket_id)}
                                  disabled={voiding}
                                  className="px-4 py-2 bg-red-600 text-white rounded-md disabled:opacity-50"
                                >
                                  {voiding ? 'Voiding...' : 'Confirm void'}
                                </button>
                              </div>
                            </div>
                          )}

                          {o.tickets.installation_date && o.confirmation_status === 'pending' && (
                            <div className="mt-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSatisfactionNoteFor(satisfactionNoteFor === o.id ? null : o.id);
                                  setSatisfactionNote('');
                                }}
                                className="px-3 py-1.5 border rounded-md text-sm bg-white"
                              >
                                Log follow-up call
                              </button>
                            </div>
                          )}

                          {satisfactionNoteFor === o.id && (
                            <div onClick={(e) => e.stopPropagation()} className="mt-3 pt-3 border-t flex gap-2">
                              <input
                                placeholder="What did they say? (3+ words)"
                                className="border rounded px-3 py-2 flex-1 bg-white"
                                value={satisfactionNote}
                                onChange={(e) => setSatisfactionNote(e.target.value)}
                              />
                              <button
                                onClick={() => handleConfirmSatisfaction(o.id)}
                                disabled={confirmingSatisfaction}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50"
                              >
                                {confirmingSatisfaction ? 'Saving...' : 'Confirm'}
                              </button>
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
