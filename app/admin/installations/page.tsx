'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ProductPicker from '@/components/ProductPicker';
import CustomerFields from '@/components/CustomerFields';
import AppShell from '@/components/AppShell';
import { useConfirm } from '@/components/useConfirm';
import BookingForm from '@/components/BookingForm';
import { todayIST } from '@/lib/dates';
import { formatINR, toStartCase } from '@/lib/format';

// Label on the left, the field on the right — placeholder text alone was
// too faint to read reliably, a real label always is.
function FormRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-40 shrink-0 text-sm font-medium text-ink">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
    </div>
  );
}

interface Installation {
  id: string;
  status: string;
  agreed_price: number;
  planned_installation_date: string | null;
  assigned_to_id: string | null;
  booked_date: string | null;
  booked_half_day: string | null;
  location: string | null;
  actual_notes: string | null;
  customers: { name: string; phone_number: string; address: string; area: string };
  users: { name: string } | null;
  orders: { paid_amount: number; balance_owed: number } | { paid_amount: number; balance_owed: number }[] | null;
}

// PostgREST returns an embedded to-one relation as an object or a
// single-item array depending on how it infers the relationship —
// normalize rather than assume one shape.
function firstOrder(orders: Installation['orders']): { paid_amount: number; balance_owed: number } | null {
  if (!orders) return null;
  return Array.isArray(orders) ? (orders[0] ?? null) : orders;
}

interface PurchaseItem {
  id: number;
  productDetails: string;
  productCode: string;
  extraDetails: string;
  price: string;
  paidAmount: string;
  isFree: boolean;
  listPrice: number | null;
}

function emptyPurchaseItem(id: number): PurchaseItem {
  return { id, productDetails: '', productCode: '', extraDetails: '', price: '', paidAmount: '', isFree: false, listPrice: null };
}

// Sentinel for "Others" (was "No staff — I did it myself") in the Assign
// to Staff dropdown — never a real staff id, so it can't collide with one.
const SELF_INSTALLED = '__self__';

interface StaffMember {
  id: string;
  name: string;
  approvedLeave: { start_date: string; end_date: string }[];
}

export default function InstallationsPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <InstallationsPageInner />
    </Suspense>
  );
}

function InstallationsPageInner() {
  // Dashboard's "+ New Purchase" links here with ?new=1 to open the form directly.
  const searchParams = useSearchParams();
  const router = useRouter();
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookForm, setBookForm] = useState({ assignedToId: '', bookedDate: '', bookedHalfDay: 'morning', location: 'home' });
  const [showPurchaseForm, setShowPurchaseForm] = useState(searchParams.get('new') === '1');
  // Set when arriving via an enquiry's Convert button — the enquiry stays
  // open and visible in its own list right up until this purchase is
  // actually submitted, at which point it's the one that closes it out.
  const [fromEnquiryId] = useState(searchParams.get('fromEnquiry'));
  const [purchaseForm, setPurchaseForm] = useState({
    phoneNumber: searchParams.get('phoneNumber') ?? '',
    name: searchParams.get('name') ?? '',
    address: searchParams.get('address') ?? '',
    area: searchParams.get('area') ?? '',
    customerId: null as string | null,
    forceNewAddress: false,
    billDate: todayIST(),
    // Defaults to the same day as Bill Date — most purchases are installed
    // the same day they're sold — but still editable/clearable for one
    // that isn't.
    plannedInstallationDate: todayIST(),
    assignedToId: '',
    bookedHalfDay: 'morning',
  });
  // Usually one product, but a Vessel sale can come with a free Kitchen
  // unit thrown in for inventory reasons — each still needs its own
  // ticket/order, so the form supports adding more than one product.
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([emptyPurchaseItem(0)]);
  const [nextItemId, setNextItemId] = useState(1);
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirm, confirmDialog] = useConfirm();
  // Installation completed — an inline date panel (today by default,
  // editable to an earlier date) instead of a plain yes/no confirm.
  const [installConfirmId, setInstallConfirmId] = useState<string | null>(null);
  const [installConfirmDate, setInstallConfirmDate] = useState(todayIST());
  const [installConfirming, setInstallConfirming] = useState(false);

  const updatePurchaseItem = (id: number, patch: Partial<PurchaseItem>) =>
    setPurchaseItems((items) => items.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const addPurchaseItem = () => {
    setPurchaseItems((items) => [...items, emptyPurchaseItem(nextItemId)]);
    setNextItemId((n) => n + 1);
  };

  const removePurchaseItem = (id: number) =>
    setPurchaseItems((items) => (items.length > 1 ? items.filter((it) => it.id !== id) : items));

  const load = async () => {
    setLoading(true);
    const [instRes, staffRes] = await Promise.all([
      fetch('/api/admin/installations', { cache: 'no-store' }),
      fetch('/api/admin/staff', { cache: 'no-store' }),
    ]);
    const instData = await instRes.json();
    const staffData = await staffRes.json();
    setInstallations(instData.installations ?? []);
    setStaff(staffData.staff ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleBook = async (e: React.FormEvent, ticketId: string) => {
    e.preventDefault();
    setError('');
    const res = await fetch(`/api/admin/installations/${ticketId}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookForm),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
      return;
    }
    setBookingId(null);
    load();
  };

  // Reassigning/rescheduling an already-booked job — same endpoint as a
  // fresh booking (it's just an update either way), pre-filled with
  // what's there now instead of starting blank.
  const startEditBooking = (inst: Installation) => {
    setError('');
    setBookingId(inst.id);
    setBookForm({
      assignedToId: inst.assigned_to_id ?? '',
      bookedDate: inst.booked_date ?? '',
      bookedHalfDay: inst.booked_half_day ?? 'morning',
      location: inst.location ?? 'home',
    });
  };

  const handleUnassign = async (ticketId: string) => {
    if (!(await confirm('Put this job back to dispatch? It stays as a purchase, just unassigned and unscheduled.'))) return;
    setError('');
    const res = await fetch(`/api/admin/tickets/${ticketId}/unassign`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Failed to put back to dispatch');
      return;
    }
    load();
  };

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purchaseSubmitting) return; // a fast double-click on Record purchase must never record it twice
    setPurchaseSubmitting(true);
    setPurchaseError('');
    const res = await fetch('/api/admin/installations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...purchaseForm,
        items: purchaseItems.map((it) => ({
          productDetails: [it.productDetails, it.extraDetails].filter(Boolean).join(' — '),
          productCode: it.productCode || undefined,
          price: it.isFree ? 0 : Number(it.price || 0),
          paidAmount: it.isFree ? 0 : Number(it.paidAmount || 0),
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPurchaseSubmitting(false);
      setPurchaseError(data.error ?? 'Failed to record purchase');
      return;
    }

    // A staff member was picked alongside the planned installation date —
    // book every ticket just created straight to them, same as the
    // separate "Book" step below would, instead of making the admin
    // repeat it right after. All items in one purchase share the same
    // planned date, so they get the same assignment too. A booking
    // failure here doesn't undo the purchase, which already succeeded —
    // just surfaced as a warning; the ticket(s) stay ready to book below.
    // "No staff" is the other case entirely — no technician, no
    // dispatch, the admin/owner already installed it themselves, so each
    // ticket goes straight to self-complete instead of being booked.
    let bookingFailed = false;
    if (purchaseForm.assignedToId === SELF_INSTALLED) {
      const selfCompleteResults = await Promise.all(
        (data.results ?? []).map((r: { ticket: { id: string } }) =>
          fetch(`/api/admin/tickets/${r.ticket.id}/self-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actualDate: purchaseForm.plannedInstallationDate }),
          })
        )
      );
      bookingFailed = selfCompleteResults.some((r) => !r.ok);
    } else if (purchaseForm.assignedToId) {
      const bookingResults = await Promise.all(
        (data.results ?? []).map((r: { ticket: { id: string } }) =>
          fetch(`/api/admin/installations/${r.ticket.id}/book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              assignedToId: purchaseForm.assignedToId,
              bookedDate: purchaseForm.plannedInstallationDate,
              bookedHalfDay: purchaseForm.bookedHalfDay,
              location: 'home',
            }),
          })
        )
      );
      bookingFailed = bookingResults.some((r) => !r.ok);
    }
    setPurchaseSubmitting(false);
    if (bookingFailed) {
      setPurchaseError(
        purchaseForm.assignedToId === SELF_INSTALLED
          ? 'Purchase recorded, but marking it done under Others failed — try again below.'
          : 'Purchase recorded, but assigning staff failed — book it manually below.'
      );
    }

    // The purchase is real now — this is the moment the source enquiry
    // (if there was one) actually moves out of Enquiries, not any earlier.
    if (fromEnquiryId) {
      await fetch(`/api/admin/enquiries/${fromEnquiryId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert' }),
      }).catch(() => {
        // The purchase itself already succeeded — a failure closing the
        // old enquiry record is a loose end to tidy up, not a reason to
        // tell the admin their purchase didn't go through.
      });
    }

    setPurchaseForm({
      phoneNumber: '',
      name: '',
      address: '',
      area: '',
      customerId: null,
      forceNewAddress: false,
      billDate: todayIST(),
      plannedInstallationDate: todayIST(),
      assignedToId: '',
      bookedHalfDay: 'morning',
    });
    // Fresh id (not reused) so the ProductPicker below remounts and clears
    // its own brand/name/variant state instead of appearing stale.
    setPurchaseItems([emptyPurchaseItem(nextItemId)]);
    setNextItemId((n) => n + 1);
    setShowPurchaseForm(false);
    load();
  };

  // No technician login to mark their own job done any more — the tech
  // reports back over Telegram/phone and admin records it here. Same
  // action as the dashboard's "Finished Installation/Service" card,
  // reachable here too for anyone working straight off this page.
  // One click does the whole thing now — mark done and confirm/close in
  // the same action, instead of a separate "Confirm & close" step after.
  // Completion date defaults to today but is editable to an earlier date
  // for a job confirmed a day or two late.
  const startInstallConfirm = (ticketId: string) => {
    setError('');
    setInstallConfirmId(ticketId);
    setInstallConfirmDate(todayIST());
  };

  const handleConfirmInstallDone = async (ticketId: string) => {
    setError('');
    setInstallConfirming(true);
    // Marks done and closes in the same request now (see mark-done's own
    // route for why) — one call, not two, so there's no gap a network
    // blip could strand this job in.
    const res = await fetch(`/api/admin/tickets/${ticketId}/mark-done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actualDate: installConfirmDate }),
    });
    setInstallConfirming(false);
    if (!res.ok) {
      setError((await res.json()).error ?? 'Failed to mark done');
      return;
    }
    setInstallConfirmId(null);
    load();
  };

  // §6.3: show how much load each tech is carrying for a given date/half-day.
  const loadFor = (staffId: string, date: string, halfDay: string) =>
    installations.filter(
      (i) => i.booked_date === date && i.booked_half_day === halfDay && i.assigned_to_id === staffId
    ).length;

  return (
    <AppShell title="New purchase">
    <div className="max-w-5xl mx-auto">
      {confirmDialog}
      <div className="flex flex-wrap justify-between items-center gap-2 mb-6 mt-2">
        <button
          onClick={() => {
            // Cancelling out of a purchase that only exists because Convert
            // sent us here should return to that enquiry, not strand the
            // admin on an empty Installations page.
            if (showPurchaseForm && fromEnquiryId) {
              router.push(`/admin/enquiries/${fromEnquiryId}`);
              return;
            }
            setShowPurchaseForm((s) => !s);
          }}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white"
        >
          {showPurchaseForm ? 'Cancel' : '+ New Purchase'}
        </button>
      </div>

      {showPurchaseForm && (
        <form onSubmit={handleCreatePurchase} className="bg-surface p-4 rounded-lg shadow-sm border border-rule mb-6 space-y-3">
          <p className="text-sm text-ink-2">
            {fromEnquiryId
              ? "Converting this enquiry — it stays in Enquiries until you submit this purchase, then moves out for real."
              : "For a sale that's already decided — skips the enquiry/call steps and goes straight to booking a tech."}
          </p>
          {purchaseError && <p className="text-danger text-sm">{purchaseError}</p>}
          <CustomerFields
            value={{
              phoneNumber: purchaseForm.phoneNumber,
              name: purchaseForm.name,
              address: purchaseForm.address,
              area: purchaseForm.area,
              customerId: purchaseForm.customerId,
              forceNewAddress: purchaseForm.forceNewAddress,
            }}
            onChange={(v) => setPurchaseForm({ ...purchaseForm, ...v })}
          />
          <div className="space-y-4">
            {purchaseItems.map((item, idx) => (
              <div key={item.id} className={purchaseItems.length > 1 ? 'border rounded-md p-3 space-y-3' : 'space-y-3'}>
                {purchaseItems.length > 1 && (
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-medium text-ink-2">Product {idx + 1}</p>
                    <button
                      type="button"
                      onClick={() => removePurchaseItem(item.id)}
                      className="text-xs text-danger hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                )}
                <FormRow label="Product" required>
                  <div className="flex-1">
                    <ProductPicker
                      key={item.id}
                      required
                      onChange={(picked) =>
                        updatePurchaseItem(item.id, {
                          productDetails: picked?.display ?? '',
                          productCode: picked?.code ?? '',
                          listPrice: picked?.listPrice ?? null,
                        })
                      }
                    />
                    {item.listPrice != null && (
                      <p className="text-xs text-ink-2 mt-1">List price: {formatINR(item.listPrice)}</p>
                    )}
                    <input
                      placeholder="Extra details (optional — e.g. 'and Prefilter')"
                      className="w-full border rounded px-3 py-2 text-ink mt-2 text-sm"
                      value={item.extraDetails}
                      onChange={(e) => updatePurchaseItem(item.id, { extraDetails: e.target.value })}
                    />
                  </div>
                </FormRow>
                <FormRow label="Sold price" required>
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      required={!item.isFree}
                      disabled={item.isFree}
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full border rounded px-3 py-2 text-ink disabled:bg-inset"
                      value={item.isFree ? '0' : item.price}
                      onChange={(e) => updatePurchaseItem(item.id, { price: e.target.value })}
                    />
                    <label className="flex items-center gap-1 text-sm text-ink whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={item.isFree}
                        onChange={(e) =>
                          updatePurchaseItem(item.id, { isFree: e.target.checked, price: '0', paidAmount: '0' })
                        }
                      />
                      Free
                    </label>
                  </div>
                </FormRow>
                <FormRow label="Paid so far" required>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={item.isFree}
                    className="w-full border rounded px-3 py-2 text-ink disabled:bg-inset"
                    value={item.isFree ? '0' : item.paidAmount}
                    onChange={(e) => updatePurchaseItem(item.id, { paidAmount: e.target.value })}
                  />
                </FormRow>
              </div>
            ))}
            <button
              type="button"
              onClick={addPurchaseItem}
              className="text-sm text-accent-deep hover:underline"
            >
              + Add another product
            </button>
            <p className="text-xs text-ink-2 -mt-2">
              Use "Free" for a product thrown in with another sale (e.g. a free Kitchen unit with
              a Vessel purchase) — it still gets its own installation ticket and shows as its own
              row in Orders, just with nothing owed.
            </p>
          </div>
          <FormRow label="Bill date" required>
            <input
              required
              type="date"
              className="w-full border rounded px-3 py-2 text-ink"
              value={purchaseForm.billDate}
              onChange={(e) => setPurchaseForm({ ...purchaseForm, billDate: e.target.value })}
            />
          </FormRow>
          <FormRow label="Planned installation">
            <input
              type="date"
              className="w-full border rounded px-3 py-2 text-ink"
              value={purchaseForm.plannedInstallationDate}
              onChange={(e) => setPurchaseForm({ ...purchaseForm, plannedInstallationDate: e.target.value })}
            />
          </FormRow>
          {purchaseForm.plannedInstallationDate && (
            <FormRow label="Assign to Staff">
              <div className="flex-1 flex gap-2">
                <select
                  className="flex-1 border rounded px-3 py-2 text-ink"
                  value={purchaseForm.assignedToId}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, assignedToId: e.target.value })}
                >
                  <option value="">(not yet decided)</option>
                  {/* No technician involved at all — the admin/owner
                      installed it themselves at the moment of sale, so
                      there's nothing to schedule or dispatch; this closes
                      the purchase immediately instead of booking a job. */}
                  <option value={SELF_INSTALLED}>Others</option>
                  {/* Excludes a real "Others" service_staff account if one
                      exists — the sentinel above already covers this exact
                      slot for a purchase (immediate, no assignee shown),
                      so both would otherwise render as two identical
                      "Others" entries in the same list. */}
                  {staff.filter((s) => s.name !== 'Others').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {purchaseForm.assignedToId !== SELF_INSTALLED && (
                  <select
                    className="border rounded px-3 py-2 text-ink"
                    value={purchaseForm.bookedHalfDay}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, bookedHalfDay: e.target.value })}
                  >
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                  </select>
                )}
              </div>
            </FormRow>
          )}
          <button
            type="submit"
            disabled={purchaseSubmitting}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white disabled:opacity-50"
          >
            {purchaseSubmitting ? 'Recording...' : 'Record purchase'}
          </button>
        </form>
      )}

      {error && <p className="text-danger bg-danger-tint p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : installations.length === 0 ? (
        <p className="text-ink">No installations in progress.</p>
      ) : (
        <div className="space-y-4">
          {installations.map((inst) => (
            <div key={inst.id} className="bg-surface rounded-lg shadow-sm border border-rule p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">
                    {inst.customers.name} — {inst.customers.phone_number}
                  </p>
                  <p className="text-sm text-ink-2">
                    {inst.customers.address}, {inst.customers.area}
                  </p>
                  <p className="text-sm text-ink-2 mt-1">Agreed price: {formatINR(inst.agreed_price)}</p>
                  {inst.planned_installation_date && !inst.booked_date && (
                    <p className="text-sm text-accent-deep">Planned for: {inst.planned_installation_date}</p>
                  )}
                  {firstOrder(inst.orders) && (
                    <p className="text-sm text-ink-2">
                      Paid: {formatINR(firstOrder(inst.orders)!.paid_amount)}
                      {firstOrder(inst.orders)!.balance_owed > 0 && (
                        <span className="text-danger"> · {formatINR(firstOrder(inst.orders)!.balance_owed)} owed</span>
                      )}
                    </p>
                  )}
                  <p className="text-sm mt-1">
                    Status: <span className="font-medium">{inst.status}</span>
                    {inst.booked_date && (
                      <>
                        {' · '}
                        {inst.booked_date} ({inst.booked_half_day}) at {inst.location}
                      </>
                    )}
                    {inst.users && <> · assigned to {inst.users.name}</>}
                  </p>
                  {/* What the tech recorded, right where the admin decides
                      whether to confirm it — confirming here stamps
                      installation_date and starts the warranty clock. */}
                  {inst.status === 'completed' && (
                    <p className="text-sm bg-inset rounded-md p-2 mt-2">
                      <span className="text-ink-2">Tech&apos;s notes:</span> {inst.actual_notes || '—'}
                    </p>
                  )}
                </div>

                <div className="space-x-2">
                  {inst.status === 'open' && (
                    <button
                      onClick={() => setBookingId(bookingId === inst.id ? null : inst.id)}
                      className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover"
                    >
                      Book
                    </button>
                  )}
                  {inst.status === 'booked' && (
                    <>
                      <button
                        onClick={() => (bookingId === inst.id ? setBookingId(null) : startEditBooking(inst))}
                        className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent-tint"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleUnassign(inst.id)}
                        className="px-3 py-1.5 border border-danger text-danger rounded-md text-sm hover:bg-danger-tint"
                      >
                        Put back to dispatch
                      </button>
                      <button
                        onClick={() => (installConfirmId === inst.id ? setInstallConfirmId(null) : startInstallConfirm(inst.id))}
                        className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover"
                      >
                        Installation completed
                      </button>
                    </>
                  )}
                </div>
              </div>

              {installConfirmId === inst.id && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <p className="text-sm text-ink-2">
                    {toStartCase(inst.customers.name)} — {inst.customers.phone_number}. Please call the customer to
                    confirm before marking this installation complete.
                  </p>
                  {error && <p className="text-danger text-sm">{error}</p>}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-ink-2 shrink-0" htmlFor={`install-date-${inst.id}`}>
                      Completion date
                    </label>
                    <input
                      id={`install-date-${inst.id}`}
                      type="date"
                      max={todayIST()}
                      value={installConfirmDate}
                      onChange={(e) => setInstallConfirmDate(e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => handleConfirmInstallDone(inst.id)}
                      disabled={installConfirming}
                      className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm disabled:opacity-50"
                    >
                      {installConfirming ? 'Saving...' : 'Confirm'}
                    </button>
                    <button onClick={() => setInstallConfirmId(null)} className="text-sm text-ink-2 hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {bookingId === inst.id && (
                <form onSubmit={(e) => handleBook(e, inst.id)} className="mt-4 pt-4 border-t space-y-3">
                  {/* Installations always happen at the customer's home — no
                      office option here (unlike a service visit, where a
                      customer can bring their unit in). bookForm.location
                      stays fixed at 'home'. */}
                  <BookingForm
                    staff={staff}
                    value={bookForm}
                    onChange={setBookForm}
                    showLocation={false}
                    submitLabel="Confirm booking"
                    extra={
                      bookForm.assignedToId &&
                      bookForm.bookedDate && (
                        <p className="text-xs text-ink-2">
                          This person already has {loadFor(bookForm.assignedToId, bookForm.bookedDate, bookForm.bookedHalfDay)} job(s)
                          in this half-day.
                        </p>
                      )
                    }
                  />
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
