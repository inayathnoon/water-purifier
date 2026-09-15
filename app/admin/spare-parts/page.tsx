'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useConfirm } from '@/components/useConfirm';
import { todayIST, isWithinWarranty } from '@/lib/dates';
import { formatINR } from '@/lib/format';

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
  ticket_id: string | null;
  users: { name: string } | null;
}

// A "Service charges" row exists for use when a spare part is sold as
// part of confirming an actual service visit — doesn't belong in a
// standalone office sale, where no visit is happening at all.
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
  // ?new=1 opens the sale form directly. When linked from the admin
  // dashboard's "Finished Installation/Service" card (?ticketId=...&
  // kind=...&customerName=...&phone=...), the sale is tagged to that job
  // — see recordSparePartSale()'s §13.3 warranty check.
  const searchParams = useSearchParams();
  const router = useRouter();
  const ticketId = searchParams.get('ticketId');
  const ticketKind = searchParams.get('kind');
  // Reaching this page for a service visit *is* the completion step now
  // — "Service completed" on the dashboard sends the admin straight here
  // instead of marking done directly. Whichever spares path they take
  // (recording a real sale, or "No parts used") also marks the job done
  // and sends them back to the dashboard, so there's exactly one place
  // this ever happens from, not two separate clicks.
  const [markDoneError, setMarkDoneError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSellForm, setShowSellForm] = useState(searchParams.get('new') === '1' || !!ticketId);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [sellQuantities, setSellQuantities] = useState<Record<string, number>>({});
  // The flat visit charge — pulled out of the regular parts list entirely
  // (not something to scroll past) and shown only in the footer, as a
  // plain editable number (defaults to the sheet's price, or 0 under
  // warranty) rather than something reached by picking a quantity.
  const [serviceChargePart, setServiceChargePart] = useState<SparePart | null>(null);
  const [serviceChargeValue, setServiceChargeValue] = useState('');
  // Reduces the spare-parts total specifically (never the service
  // charge) — a discretionary discount, separate from §13.3's automatic
  // warranty-free rule.
  const [discount, setDiscount] = useState('');
  // Extras — a custom line item for anything not in the price sheet at
  // all, alongside the normal picker.
  const [extras, setExtras] = useState<{ id: number; name: string; price: string; quantity: string }[]>([]);
  const [nextExtraId, setNextExtraId] = useState(1);
  const [sellCustomerName, setSellCustomerName] = useState(searchParams.get('customerName') ?? '');
  const [sellPhoneNumber, setSellPhoneNumber] = useState(searchParams.get('phone') ?? '');
  const [sellError, setSellError] = useState('');
  const [submittingSell, setSubmittingSell] = useState(false);
  const [recentSales, setRecentSales] = useState<SparePartSale[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ partName: '', unitPrice: '', quantity: '', customerName: '', phoneNumber: '', saleDate: '' });
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  // Only relevant when linked to a service visit — an installation or a
  // walk-in office sale has no warranty concept to check.
  const [withinWarranty, setWithinWarranty] = useState(false);
  // Whether this job has already satisfied the spares-step gate (either a
  // sale below, or "No parts needed") — a service visit can't be marked
  // done on its own page/the dashboard until this is true.
  const [sparesConfirmed, setSparesConfirmed] = useState(false);
  const [confirmingNoSpares, setConfirmingNoSpares] = useState(false);
  const [noSparesError, setNoSparesError] = useState('');
  const [confirm, confirmDialog] = useConfirm();

  const load = async () => {
    setLoading(true);
    const salesUrl = ticketId ? `/api/admin/spare-part-sales?ticketId=${ticketId}` : '/api/admin/spare-part-sales';
    const requests: Promise<Response>[] = [fetch('/api/admin/spare-parts'), fetch(salesUrl)];
    if (ticketId) requests.push(fetch(`/api/admin/tickets/${ticketId}`));
    const [sparePartsRes, salesRes, ticketRes] = await Promise.all(requests);

    let isServiceVisit = false;
    let inWarranty = false;
    if (ticketId && ticketKind === 'service_visit' && ticketRes) {
      const { ticket } = await ticketRes.json();
      inWarranty = isWithinWarranty(ticket?.installation_date ?? null, todayIST());
      setWithinWarranty(inWarranty);
      setSparesConfirmed(!!ticket?.spares_confirmed);
      isServiceVisit = true;
    }

    const allParts: SparePart[] = (await sparePartsRes.json()).parts ?? [];
    // The flat visit charge is never part of the scrollable picker — it's
    // its own always-there figure for a service visit, and doesn't apply
    // at all to an office/installation sale (no visit is happening).
    setSpareParts(allParts.filter((p) => !isServiceCharge(p)));
    const chargePart = isServiceVisit ? allParts.find(isServiceCharge) ?? null : null;
    setServiceChargePart(chargePart);
    // Defaults to the sheet price, or 0 when the visit is already free —
    // still just a plain editable number either way (§13.3 re-enforces
    // 0 server-side for a genuine warranty visit regardless of this).
    setServiceChargeValue(chargePart ? String(inWarranty ? 0 : chargePart.price) : '');
    setRecentSales((await salesRes.json()).sales ?? []);
    setLoading(false);
  };

  // The actual "mark this service visit done" call, fired only once the
  // spares step (whichever path) has already succeeded — see the note
  // above. Also closes the ticket in the same action (calling the
  // customer to confirm is assumed to have already happened, same as the
  // installation flow) — no separate "Called & Confirmed" click after
  // this any more. On success, home is the dashboard, same for either path.
  const markDoneAndGoHome = async () => {
    setMarkDoneError('');
    const res = await fetch(`/api/admin/tickets/${ticketId}/mark-done`, { method: 'POST' });
    if (!res.ok) {
      setMarkDoneError((await res.json()).error ?? 'Spares saved, but marking the job done failed — try again below.');
      return;
    }
    const closeRes = await fetch(`/api/admin/tickets/${ticketId}/close`, { method: 'POST' });
    if (!closeRes.ok) {
      setMarkDoneError((await closeRes.json()).error ?? 'Marked done, but confirming failed — try again from Services.');
      return;
    }
    router.push('/dashboard');
  };

  const handleNoSparesNeeded = async () => {
    if (confirmingNoSpares) return;
    setConfirmingNoSpares(true);
    setNoSparesError('');
    const res = await fetch(`/api/admin/tickets/${ticketId}/confirm-no-spares`, { method: 'POST' });
    setConfirmingNoSpares(false);
    if (!res.ok) {
      setNoSparesError((await res.json()).error ?? 'Failed to save');
      return;
    }
    setSparesConfirmed(true);
    if (ticketKind === 'service_visit') await markDoneAndGoHome();
  };

  const handleUndoNoSpares = async () => {
    if (confirmingNoSpares) return;
    setConfirmingNoSpares(true);
    setNoSparesError('');
    const res = await fetch(`/api/admin/tickets/${ticketId}/unconfirm-spares`, { method: 'POST' });
    setConfirmingNoSpares(false);
    if (!res.ok) {
      setNoSparesError((await res.json()).error ?? 'Failed to undo');
      return;
    }
    setSparesConfirmed(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adjustSellQty = (name: string, delta: number) => {
    setSellQuantities((prev) => ({ ...prev, [name]: Math.max(0, (prev[name] ?? 0) + delta) }));
  };

  // Under warranty, every part is free — shown as such, not just silently
  // charged 0, so it's clear this isn't a bug (§13.3 is still enforced
  // server-side in recordSparePartSale() regardless of what's shown here).
  const displayPrice = (p: SparePart) => (withinWarranty ? 0 : p.price);
  const addExtra = () => {
    setExtras((rows) => [...rows, { id: nextExtraId, name: '', price: '', quantity: '1' }]);
    setNextExtraId((n) => n + 1);
  };
  const updateExtra = (id: number, patch: Partial<{ name: string; price: string; quantity: string }>) =>
    setExtras((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeExtra = (id: number) => setExtras((rows) => rows.filter((r) => r.id !== id));

  // The spare-parts side of the total — picked parts plus extras, before
  // the discount below. The service charge is a separate figure entirely
  // (its own editable number, footer-only) and never part of this sum.
  const sparePartsTotal =
    spareParts.reduce((sum, p) => sum + (sellQuantities[p.name] ?? 0) * displayPrice(p), 0) +
    extras.reduce((sum, x) => sum + (Number(x.price) || 0) * (Number(x.quantity) || 0), 0);
  // Never below zero, and never more than the parts total itself — a
  // discount can zero the parts out, not flip the sale negative.
  const discountAmount = Math.min(Math.max(0, Number(discount) || 0), sparePartsTotal);
  const serviceChargeAmount = serviceChargePart ? Math.max(0, Number(serviceChargeValue) || 0) : 0;
  const sellTotal = serviceChargeAmount + sparePartsTotal - discountAmount;

  const handleSellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingSell) return;
    const pickedItems = spareParts
      .filter((p) => (sellQuantities[p.name] ?? 0) > 0)
      .map((p) => ({ partName: p.name, unitPrice: displayPrice(p), quantity: sellQuantities[p.name] }));
    const extraItems = extras
      .filter((x) => x.name.trim() && Number(x.quantity) > 0)
      .map((x) => ({ partName: x.name.trim(), unitPrice: withinWarranty ? 0 : Number(x.price) || 0, quantity: Number(x.quantity) }));
    // Always included for a service visit — the flat charge is "there"
    // whether or not the admin picked any other part — at whatever value
    // the footer's own field holds (§13.3 still re-forces 0 server-side
    // for a genuine warranty visit regardless of what's typed here).
    const serviceChargeItems = serviceChargePart ? [{ partName: serviceChargePart.name, unitPrice: serviceChargeAmount, quantity: 1 }] : [];
    // The discount reduces the spare-parts total specifically — recorded
    // as its own negative line rather than distorting any real part's
    // price, so the sheet/ledger stays an honest record of what actually
    // happened (a real sale, then a discount applied to it).
    const discountItems = discountAmount > 0 ? [{ partName: 'Discount', unitPrice: -discountAmount, quantity: 1 }] : [];
    const items = [...pickedItems, ...extraItems, ...discountItems, ...serviceChargeItems];
    if (items.length === 0) {
      // Sometimes nothing gets charged even outside warranty (a
      // relationship call, goodwill, whatever the reason) — for a linked
      // service visit this isn't blocked, just confirmed, and is exactly
      // the same outcome as clicking "No parts used" below. A plain
      // office/installation sale has nothing to attribute a ₹0 record to,
      // so that case stays a hard block.
      if (ticketId && ticketKind === 'service_visit') {
        if (!(await confirm('No spares or extras added — record this as ₹0 and mark it done?'))) return;
        await handleNoSparesNeeded();
        return;
      }
      setSellError('Pick at least one part, or add an extra.');
      return;
    }
    setSubmittingSell(true);
    setSellError('');
    const res = await fetch('/api/admin/spare-part-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customerName: sellCustomerName, phoneNumber: sellPhoneNumber, ticketId: ticketId || undefined }),
    });
    setSubmittingSell(false);
    if (!res.ok) {
      setSellError((await res.json()).error ?? 'Failed to record sale');
      return;
    }
    setSellQuantities({});
    setDiscount('');
    setExtras([]);
    if (!ticketId) {
      setSellCustomerName('');
      setSellPhoneNumber('');
      setShowSellForm(false);
    }
    if (ticketId && ticketKind === 'service_visit') {
      setSparesConfirmed(true);
      await markDoneAndGoHome();
      return;
    }
    load();
  };

  const startEditing = (s: SparePartSale) => {
    setEditError('');
    setEditingId(s.id);
    setEditForm({
      partName: s.part_name,
      unitPrice: String(s.unit_price),
      quantity: String(s.quantity),
      customerName: s.customer_name ?? '',
      phoneNumber: s.phone_number ?? '',
      saleDate: s.created_at.slice(0, 10),
    });
  };

  const handleSaveEdit = async (e: React.FormEvent, saleId: string) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setEditError('');
    const res = await fetch(`/api/admin/spare-part-sales/${saleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partName: editForm.partName,
        unitPrice: Number(editForm.unitPrice),
        quantity: Number(editForm.quantity),
        customerName: editForm.customerName,
        phoneNumber: editForm.phoneNumber,
        saleDate: editForm.saleDate,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setEditError((await res.json()).error ?? 'Failed to save');
      return;
    }
    setEditingId(null);
    load();
  };

  return (
    <AppShell title="Spares">
    <div className="max-w-3xl mx-auto">
      {confirmDialog}
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1 mt-2">
        {!ticketId && (
          <button
            onClick={() => setShowSellForm((s) => !s)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white"
          >
            {showSellForm ? 'Cancel' : '+ Spare Part'}
          </button>
        )}
      </div>
      <p className="text-sm text-ink-2 mb-6">
        {ticketId
          ? 'Spare parts sold as part of confirming this job — linked back to it automatically.'
          : 'A part sold on its own at the office — no visit, no job, customer details optional.'}
      </p>

      {markDoneError && <p className="text-danger text-sm mb-4">{markDoneError}</p>}

      {ticketId && ticketKind === 'service_visit' && (
        <div className="mb-6">
          {sparesConfirmed ? (
            <div className="flex items-center gap-3">
              <p className="text-sm bg-ok-tint text-ok rounded-md px-3 py-2 flex-1">
                Spares step done for this job — it can now be marked complete.
              </p>
              {noSparesError && <p className="text-danger text-xs">{noSparesError}</p>}
              <button
                onClick={handleUndoNoSpares}
                disabled={confirmingNoSpares}
                className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent-tint disabled:opacity-50 whitespace-nowrap"
              >
                Undo
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {noSparesError && <p className="text-danger text-xs">{noSparesError}</p>}
              <button
                onClick={handleNoSparesNeeded}
                disabled={confirmingNoSpares}
                className="text-sm text-ink-2 hover:underline disabled:opacity-50"
              >
                {confirmingNoSpares ? 'Saving...' : 'No parts used'}
              </button>
            </div>
          )}
        </div>
      )}

      {showSellForm && (
        <form onSubmit={handleSellSubmit} className="bg-surface p-4 rounded-lg shadow-sm border border-rule mb-8 space-y-3 pb-28">
          {sellError && <p className="text-danger text-sm">{sellError}</p>}
          {withinWarranty && (
            <p className="text-sm bg-accent-tint text-accent-deep rounded-md px-3 py-2">
              Still under warranty — any parts used here are free of charge.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Customer name (optional)"
              className="border rounded px-3 py-2 text-ink"
              value={sellCustomerName}
              onChange={(e) => setSellCustomerName(e.target.value.toUpperCase())}
              readOnly={!!ticketId}
            />
            <input
              placeholder="Phone number (optional)"
              className="border rounded px-3 py-2 text-ink"
              value={sellPhoneNumber}
              onChange={(e) => setSellPhoneNumber(e.target.value)}
              readOnly={!!ticketId}
            />
          </div>

          <div className="border rounded-lg divide-y">
            {spareParts.length === 0 ? (
              <p className="text-sm text-ink-2 p-3">No spare parts loaded — check the sheet.</p>
            ) : (
              spareParts.map((p) => (
                <div key={p.name} className="flex justify-between items-center p-3">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-ink-2">{withinWarranty ? 'Free' : formatINR(p.price)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => adjustSellQty(p.name, -1)}
                      className="w-9 h-9 rounded-full border text-lg font-semibold active:bg-inset"
                    >
                      −
                    </button>
                    <span className="w-5 text-center">{sellQuantities[p.name] ?? 0}</span>
                    <button
                      type="button"
                      onClick={() => adjustSellQty(p.name, 1)}
                      className="w-9 h-9 rounded-full border text-lg font-semibold active:bg-inset"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Extras — anything not in the price sheet at all, e.g. a
              one-off part or a custom charge. */}
          <div className="space-y-2">
            {extras.map((x) => (
              <div key={x.id} className="flex items-center gap-2">
                <input
                  placeholder="Extra item name"
                  value={x.name}
                  onChange={(e) => updateExtra(x.id, { name: e.target.value })}
                  className="border rounded px-2 py-1.5 text-sm flex-1"
                />
                <span className="text-xs text-ink-2">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Price"
                  value={x.price}
                  onChange={(e) => updateExtra(x.id, { price: e.target.value })}
                  className="border rounded px-2 py-1.5 text-sm w-24"
                  disabled={withinWarranty}
                />
                <span className="text-xs text-ink-2">×</span>
                <input
                  type="number"
                  min="1"
                  value={x.quantity}
                  onChange={(e) => updateExtra(x.id, { quantity: e.target.value })}
                  className="border rounded px-2 py-1.5 text-sm w-16"
                />
                <button type="button" onClick={() => removeExtra(x.id)} className="text-sm text-danger hover:underline">
                  Remove
                </button>
              </div>
            ))}
            <button type="button" onClick={addExtra} className="text-sm text-accent-deep hover:underline">
              + Add extra
            </button>
          </div>

          {/* Fixed to the bottom of the viewport, not the form — visible
              the whole time the admin is scrolling through the parts
              list above. Service charge + Spare parts (calculated) −
              Discount = Total, spelled out so it's clear where every
              rupee in the total actually comes from. */}
          <div className="fixed bottom-0 inset-x-0 bg-surface border-t border-rule shadow-lg z-20">
            <div className="max-w-3xl mx-auto px-4 py-3 flex flex-wrap items-center gap-6">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {serviceChargePart && (
                  <>
                    <span className="text-ink-2">Service charge</span>
                    <span className="text-ink-2">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={serviceChargeValue}
                      onChange={(e) => setServiceChargeValue(e.target.value)}
                      className="w-20 border rounded px-2 py-1"
                    />
                    <span className="text-ink-2">+</span>
                  </>
                )}
                <span className="text-ink-2">Spare parts</span>
                <span className="font-medium">{formatINR(sparePartsTotal)}</span>
                <span className="text-ink-2">−</span>
                <span className="text-ink-2">Discount</span>
                <span className="text-ink-2">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-20 border rounded px-2 py-1"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xl font-bold whitespace-nowrap">= {formatINR(sellTotal)}</span>
                <button
                  type="submit"
                  disabled={submittingSell}
                  className="px-6 py-3 text-base bg-accent hover:bg-accent-hover text-white font-semibold disabled:opacity-50 whitespace-nowrap"
                >
                  {submittingSell ? 'Recording...' : 'Record sale'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      <h2 className="text-lg font-semibold mb-2">{ticketId ? 'Recorded for this job' : 'Recent sales'}</h2>
      {loading ? (
        <p>Loading...</p>
      ) : recentSales.length === 0 ? (
        <p className="text-ink">{ticketId ? 'Nothing recorded yet.' : 'No spare part sales yet.'}</p>
      ) : (
        <div className="bg-surface rounded-lg shadow-sm border border-rule divide-y">
          {recentSales.map((s) => (
            <div key={s.id} className="p-3 text-sm">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">
                    {s.part_name} x{s.quantity}
                    {s.customer_name && <span className="text-ink font-normal"> — {s.customer_name}</span>}
                  </p>
                  <p className="text-xs text-ink-2">
                    {new Date(s.created_at).toLocaleString()} · sold by {s.users?.name ?? 'Unknown'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{formatINR(s.total)}</span>
                  <button
                    onClick={() => (editingId === s.id ? setEditingId(null) : startEditing(s))}
                    className="text-xs text-ink-2 hover:underline"
                  >
                    {editingId === s.id ? 'Cancel' : 'Edit'}
                  </button>
                </div>
              </div>

              {editingId === s.id && (
                <form onSubmit={(e) => handleSaveEdit(e, s.id)} className="mt-3 pt-3 border-t space-y-2">
                  {editError && <p className="text-danger text-xs">{editError}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      required
                      max={todayIST()}
                      className="border rounded px-2 py-1.5"
                      value={editForm.saleDate}
                      onChange={(e) => setEditForm({ ...editForm, saleDate: e.target.value })}
                    />
                    <input
                      required
                      placeholder="Part name"
                      className="border rounded px-2 py-1.5"
                      value={editForm.partName}
                      onChange={(e) => setEditForm({ ...editForm, partName: e.target.value })}
                    />
                    <input
                      required
                      type="number"
                      min="1"
                      placeholder="Quantity"
                      className="border rounded px-2 py-1.5"
                      value={editForm.quantity}
                      onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                    />
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Unit price"
                      className="border rounded px-2 py-1.5"
                      value={editForm.unitPrice}
                      onChange={(e) => setEditForm({ ...editForm, unitPrice: e.target.value })}
                    />
                    <input
                      placeholder="Customer name (optional)"
                      className="border rounded px-2 py-1.5"
                      value={editForm.customerName}
                      onChange={(e) => setEditForm({ ...editForm, customerName: e.target.value.toUpperCase() })}
                    />
                    <input
                      placeholder="Phone number (optional)"
                      className="border rounded px-2 py-1.5"
                      value={editForm.phoneNumber}
                      onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-accent hover:bg-accent-hover text-white disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save changes'}
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </AppShell>
  );
}
