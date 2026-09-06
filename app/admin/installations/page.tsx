'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ProductPicker from '@/components/ProductPicker';
import CustomerFields from '@/components/CustomerFields';
import HomeLink from '@/components/HomeLink';
import { useConfirm } from '@/components/useConfirm';
import BookingForm from '@/components/BookingForm';
import { todayIST } from '@/lib/dates';

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
      <label className="w-40 shrink-0 text-sm font-medium text-gray-900">
        {label}
        {required && <span className="text-red-600"> *</span>}
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
    plannedInstallationDate: '',
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
      fetch('/api/admin/installations'),
      fetch('/api/admin/staff'),
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
    let bookingFailed = false;
    if (purchaseForm.assignedToId) {
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
      setPurchaseError('Purchase recorded, but assigning staff failed — book it manually below.');
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
      plannedInstallationDate: '',
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

  const handleCloseAfterConfirm = async (ticketId: string) => {
    setError('');
    const res = await fetch(`/api/admin/tickets/${ticketId}/close`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
      return;
    }
    load();
  };

  // §6.3: show how much load each tech is carrying for a given date/half-day.
  const loadFor = (staffId: string, date: string, halfDay: string) =>
    installations.filter(
      (i) => i.booked_date === date && i.booked_half_day === halfDay && i.assigned_to_id === staffId
    ).length;

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      {confirmDialog}
      <HomeLink />
      <div className="flex flex-wrap justify-between items-center gap-2 mb-6 mt-2">
        <h1 className="text-2xl font-bold">New Purchase</h1>
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
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          {showPurchaseForm ? 'Cancel' : '+ New Purchase'}
        </button>
      </div>

      {showPurchaseForm && (
        <form onSubmit={handleCreatePurchase} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6 space-y-3">
          <p className="text-sm text-gray-500">
            {fromEnquiryId
              ? "Converting this enquiry — it stays in Enquiries until you submit this purchase, then moves out for real."
              : "For a sale that's already decided — skips the enquiry/call steps and goes straight to booking a tech."}
          </p>
          {purchaseError && <p className="text-red-600 text-sm">{purchaseError}</p>}
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
                    <p className="text-xs font-medium text-gray-600">Product {idx + 1}</p>
                    <button
                      type="button"
                      onClick={() => removePurchaseItem(item.id)}
                      className="text-xs text-red-600 hover:underline"
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
                      <p className="text-xs text-gray-500 mt-1">List price: ₹{item.listPrice}</p>
                    )}
                    <input
                      placeholder="Extra details (optional — e.g. 'and Prefilter')"
                      className="w-full border rounded px-3 py-2 text-gray-900 mt-2 text-sm"
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
                      className="w-full border rounded px-3 py-2 text-gray-900 disabled:bg-gray-50"
                      value={item.isFree ? '0' : item.price}
                      onChange={(e) => updatePurchaseItem(item.id, { price: e.target.value })}
                    />
                    <label className="flex items-center gap-1 text-sm text-gray-900 whitespace-nowrap">
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
                    className="w-full border rounded px-3 py-2 text-gray-900 disabled:bg-gray-50"
                    value={item.isFree ? '0' : item.paidAmount}
                    onChange={(e) => updatePurchaseItem(item.id, { paidAmount: e.target.value })}
                  />
                </FormRow>
              </div>
            ))}
            <button
              type="button"
              onClick={addPurchaseItem}
              className="text-sm text-blue-600 hover:underline"
            >
              + Add another product
            </button>
            <p className="text-xs text-gray-600 -mt-2">
              Use "Free" for a product thrown in with another sale (e.g. a free Kitchen unit with
              a Vessel purchase) — it still gets its own installation ticket and shows as its own
              row in Orders, just with nothing owed.
            </p>
          </div>
          <FormRow label="Bill date" required>
            <input
              required
              type="date"
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={purchaseForm.billDate}
              onChange={(e) => setPurchaseForm({ ...purchaseForm, billDate: e.target.value })}
            />
          </FormRow>
          <FormRow label="Planned installation">
            <input
              type="date"
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={purchaseForm.plannedInstallationDate}
              onChange={(e) => setPurchaseForm({ ...purchaseForm, plannedInstallationDate: e.target.value })}
            />
          </FormRow>
          {purchaseForm.plannedInstallationDate && (
            <FormRow label="Assign to Staff">
              <div className="flex-1 flex gap-2">
                <select
                  className="flex-1 border rounded px-3 py-2 text-gray-900"
                  value={purchaseForm.assignedToId}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, assignedToId: e.target.value })}
                >
                  <option value="">(not yet decided)</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  className="border rounded px-3 py-2 text-gray-900"
                  value={purchaseForm.bookedHalfDay}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, bookedHalfDay: e.target.value })}
                >
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </FormRow>
          )}
          <button
            type="submit"
            disabled={purchaseSubmitting}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {purchaseSubmitting ? 'Recording...' : 'Record purchase'}
          </button>
        </form>
      )}

      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : installations.length === 0 ? (
        <p className="text-gray-900">No installations in progress.</p>
      ) : (
        <div className="space-y-4">
          {installations.map((inst) => (
            <div key={inst.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">
                    {inst.customers.name} — {inst.customers.phone_number}
                  </p>
                  <p className="text-sm text-gray-500">
                    {inst.customers.address}, {inst.customers.area}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Agreed price: ₹{inst.agreed_price}</p>
                  {inst.planned_installation_date && !inst.booked_date && (
                    <p className="text-sm text-blue-700">Planned for: {inst.planned_installation_date}</p>
                  )}
                  {firstOrder(inst.orders) && (
                    <p className="text-sm text-gray-500">
                      Paid: ₹{firstOrder(inst.orders)!.paid_amount}
                      {firstOrder(inst.orders)!.balance_owed > 0 && (
                        <span className="text-red-600"> · ₹{firstOrder(inst.orders)!.balance_owed} owed</span>
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
                    <p className="text-sm bg-gray-50 rounded-md p-2 mt-2">
                      <span className="text-gray-600">Tech&apos;s notes:</span> {inst.actual_notes || '—'}
                    </p>
                  )}
                </div>

                <div className="space-x-2">
                  {inst.status === 'open' && (
                    <button
                      onClick={() => setBookingId(bookingId === inst.id ? null : inst.id)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                    >
                      Book
                    </button>
                  )}
                  {inst.status === 'booked' && (
                    <>
                      <button
                        onClick={() => (bookingId === inst.id ? setBookingId(null) : startEditBooking(inst))}
                        className="px-3 py-1.5 border rounded-md text-sm hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleUnassign(inst.id)}
                        className="px-3 py-1.5 border border-red-300 text-red-700 rounded-md text-sm hover:bg-red-50"
                      >
                        Put back to dispatch
                      </button>
                    </>
                  )}
                  {inst.status === 'completed' && (
                    <button
                      onClick={() => handleCloseAfterConfirm(inst.id)}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                    >
                      Confirm & close
                    </button>
                  )}
                </div>
              </div>

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
                        <p className="text-xs text-gray-500">
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
  );
}
