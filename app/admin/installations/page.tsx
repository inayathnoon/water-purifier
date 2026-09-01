'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ProductPicker from '@/components/ProductPicker';
import AreaSelect from '@/components/AreaSelect';

// Label on the left, the field on the right — placeholder text alone was
// too faint to read reliably, a real label always is.
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-40 shrink-0 text-sm font-medium text-gray-900">{label}</label>
      {children}
    </div>
  );
}

interface Installation {
  id: string;
  status: string;
  agreed_price: number;
  assigned_to_id: string | null;
  booked_date: string | null;
  booked_half_day: string | null;
  location: string | null;
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

interface StaffMember {
  id: string;
  name: string;
  approvedLeave: { start_date: string; end_date: string }[];
}

// §11.5: approved leave shows on the booking calendar but never blocks a booking.
function onApprovedLeave(staff: StaffMember[], staffId: string, date: string): boolean {
  if (!date) return false;
  const person = staff.find((s) => s.id === staffId);
  return (person?.approvedLeave ?? []).some((l) => date >= l.start_date && date <= l.end_date);
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
    productDetails: '',
    extraDetails: '',
    price: '',
    paidAmount: '',
  });
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseFormKey, setPurchaseFormKey] = useState(0);
  const [knownCustomer, setKnownCustomer] = useState(false);
  const [error, setError] = useState('');

  // Autofill: a phone number that's already a customer fills in their
  // name/address/area, so re-typing a repeat customer's details never
  // has a chance to accidentally create a duplicate/conflicting record.
  useEffect(() => {
    const phone = purchaseForm.phoneNumber.trim();
    if (phone.length < 6) {
      setKnownCustomer(false);
      return;
    }
    const timeout = setTimeout(() => {
      fetch(`/api/admin/customers/lookup?phone=${encodeURIComponent(phone)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.customer) {
            setKnownCustomer(true);
            setPurchaseForm((f) => ({ ...f, name: data.customer.name, address: data.customer.address, area: data.customer.area }));
          } else {
            setKnownCustomer(false);
          }
        });
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseForm.phoneNumber]);

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

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setPurchaseError('');
    const res = await fetch('/api/admin/installations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...purchaseForm,
        productDetails: [purchaseForm.productDetails, purchaseForm.extraDetails].filter(Boolean).join(' — '),
        price: Number(purchaseForm.price),
        paidAmount: Number(purchaseForm.paidAmount || 0),
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setPurchaseError(data.error ?? 'Failed to record purchase');
      return;
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

    setPurchaseForm({ phoneNumber: '', name: '', address: '', area: '', productDetails: '', extraDetails: '', price: '', paidAmount: '' });
    setKnownCustomer(false);
    setPurchaseFormKey((k) => k + 1); // remounts ProductPicker so its own brand/name/variant state clears too
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
      <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
        <h1 className="text-2xl font-bold">Installations</h1>
        <button
          onClick={() => setShowPurchaseForm((s) => !s)}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          {showPurchaseForm ? 'Cancel' : '+ New Purchase'}
        </button>
      </div>

      {showPurchaseForm && (
        <form onSubmit={handleCreatePurchase} className="bg-white p-4 rounded-lg shadow mb-6 space-y-3">
          <p className="text-sm text-gray-900">
            {fromEnquiryId
              ? "Converting this enquiry — it stays in Enquiries until you submit this purchase, then moves out for real."
              : "For a sale that's already decided — skips the enquiry/call steps and goes straight to booking a tech."}
          </p>
          {purchaseError && <p className="text-red-600 text-sm">{purchaseError}</p>}
          <FormRow label="Phone number">
            <div className="flex-1">
              <input
                required
                className="w-full border rounded px-3 py-2 text-gray-900"
                value={purchaseForm.phoneNumber}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, phoneNumber: e.target.value })}
              />
              {knownCustomer && (
                <p className="text-xs text-green-700 mt-1">Known customer — details filled in below.</p>
              )}
            </div>
          </FormRow>
          <FormRow label="Name">
            <input
              required
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={purchaseForm.name}
              onChange={(e) => setPurchaseForm({ ...purchaseForm, name: e.target.value })}
            />
          </FormRow>
          <FormRow label="Address">
            <input
              required
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={purchaseForm.address}
              onChange={(e) => setPurchaseForm({ ...purchaseForm, address: e.target.value })}
            />
          </FormRow>
          <FormRow label="Area">
            <AreaSelect required value={purchaseForm.area} onChange={(area) => setPurchaseForm({ ...purchaseForm, area })} />
          </FormRow>
          <FormRow label="Product">
            <div className="flex-1">
              <ProductPicker
                key={purchaseFormKey}
                required
                onChange={(picked) => setPurchaseForm({ ...purchaseForm, productDetails: picked?.display ?? '' })}
              />
              <input
                placeholder="Extra details (optional — e.g. 'and Prefilter')"
                className="w-full border rounded px-3 py-2 text-gray-900 mt-2 text-sm"
                value={purchaseForm.extraDetails}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, extraDetails: e.target.value })}
              />
            </div>
          </FormRow>
          <FormRow label="Price">
            <input
              required
              type="number"
              step="0.01"
              min="0"
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={purchaseForm.price}
              onChange={(e) => setPurchaseForm({ ...purchaseForm, price: e.target.value })}
            />
          </FormRow>
          <FormRow label="Paid so far">
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="optional"
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={purchaseForm.paidAmount}
              onChange={(e) => setPurchaseForm({ ...purchaseForm, paidAmount: e.target.value })}
            />
          </FormRow>
          <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">
            Record purchase
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
            <div key={inst.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">
                    {inst.customers.name} — {inst.customers.phone_number}
                  </p>
                  <p className="text-sm text-gray-900">
                    {inst.customers.address}, {inst.customers.area}
                  </p>
                  <p className="text-sm text-gray-900 mt-1">Agreed price: ₹{inst.agreed_price}</p>
                  {firstOrder(inst.orders) && (
                    <p className="text-sm text-gray-900">
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
                  <select
                    required
                    className="border rounded px-3 py-2 w-full"
                    value={bookForm.assignedToId}
                    onChange={(e) => setBookForm({ ...bookForm, assignedToId: e.target.value })}
                  >
                    <option value="">Assign to...</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      required
                      className="border rounded px-3 py-2 flex-1"
                      value={bookForm.bookedDate}
                      onChange={(e) => setBookForm({ ...bookForm, bookedDate: e.target.value })}
                    />
                    <select
                      className="border rounded px-3 py-2"
                      value={bookForm.bookedHalfDay}
                      onChange={(e) => setBookForm({ ...bookForm, bookedHalfDay: e.target.value })}
                    >
                      <option value="morning">Morning</option>
                      <option value="afternoon">Afternoon</option>
                      <option value="evening">Evening</option>
                    </select>
                    <select
                      className="border rounded px-3 py-2"
                      value={bookForm.location}
                      onChange={(e) => setBookForm({ ...bookForm, location: e.target.value })}
                    >
                      <option value="home">Home</option>
                      <option value="office">Office</option>
                    </select>
                  </div>
                  {bookForm.assignedToId && bookForm.bookedDate && (
                    <p className="text-xs text-gray-900">
                      This person already has {loadFor(bookForm.assignedToId, bookForm.bookedDate, bookForm.bookedHalfDay)} job(s)
                      in this half-day.
                    </p>
                  )}
                  {onApprovedLeave(staff, bookForm.assignedToId, bookForm.bookedDate) && (
                    <p className="text-xs text-orange-600">
                      This person is on approved leave that day — you can still book them (§11.5).
                    </p>
                  )}
                  <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Confirm booking</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
