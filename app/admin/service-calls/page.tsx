'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import CustomerFields from '@/components/CustomerFields';
import AreaSelect from '@/components/AreaSelect';
import { useConfirm } from '@/components/useConfirm';
import BookingForm from '@/components/BookingForm';
import { todayIST } from '@/lib/dates';

// Label on the left, the field on the right — matches FormRow elsewhere.
function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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

interface ServiceCall {
  id: string;
  status: 'open' | 'booked' | 'completed' | 'closed';
  created_at: string;
  booked_date: string | null;
  booked_half_day: string | null;
  location: string | null;
  charge_amount: number | null;
  parts_used: string | null;
  actual_date: string | null;
  actual_notes: string | null;
  spares_confirmed: boolean;
  assigned_to_id: string | null;
  parent_installation_id: string | null;
  product_interest: string | null;
  issue_note: string | null;
  customers: { id: string; name: string; phone_number: string; address: string; area: string };
  users: { name: string } | null;
}

interface StaffMember {
  id: string;
  name: string;
  approvedLeave: { start_date: string; end_date: string }[];
}

interface SparePartSale {
  id: string;
  part_name: string;
  quantity: number;
  total: number;
}

interface DueService {
  installationTicketId: string;
  customerName: string;
  phoneNumber: string;
  area: string;
  installationDate: string;
  monthsSinceInstall: number;
  productLabel: string | null;
}

const emptyNewService = {
  phoneNumber: '',
  name: '',
  address: '',
  area: '',
  customerId: null as string | null,
  forceNewAddress: false,
  productInterest: '',
  issueNote: '',
  staffAttendedId: '',
  bookedDate: '',
  bookedHalfDay: 'morning',
  location: 'home',
};

// Plain local time — this page is only ever used by staff physically in
// the business's own timezone, unlike the server-side IST helpers built
// for a Railway container that doesn't share that timezone.
function currentHalfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export default function ServiceCallsPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <ServiceCallsPageInner />
    </Suspense>
  );
}

function ServiceCallsPageInner() {
  // Dashboard's "+ New Service" links here with ?new=1 to open the
  // ad-hoc request form directly. "Jobs to Dispatch" and "Yearly Service
  // Calls Due" both send service-related rows here too, but to two
  // different lists on this same page (a due-but-not-yet-requested
  // installation vs. an already-requested ticket) — ?highlightInstallation
  // / ?highlightTicket say which specific row to jump to and highlight,
  // so following one of those dashboard rows doesn't just dump you on an
  // undifferentiated list.
  const searchParams = useSearchParams();
  const highlightInstallation = searchParams.get('highlightInstallation');
  const highlightTicket = searchParams.get('highlightTicket');
  const [calls, setCalls] = useState<ServiceCall[]>([]);
  const [sparePartSalesByTicket, setSparePartSalesByTicket] = useState<Record<string, SparePartSale[]>>({});
  const [due, setDue] = useState<DueService[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [callNote, setCallNote] = useState<Record<string, string>>({});
  const [declineNote, setDeclineNote] = useState<Record<string, string>>({});
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookForm, setBookForm] = useState({ assignedToId: '', bookedDate: '', bookedHalfDay: 'morning', location: 'home' });
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(searchParams.get('new') === '1');
  const [newService, setNewService] = useState(emptyNewService);
  const [newServiceError, setNewServiceError] = useState('');
  const [submittingNew, setSubmittingNew] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  // Correcting an ad-hoc request's own details — only while unvisited.
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [requestEditForm, setRequestEditForm] = useState({
    productInterest: '', issueNote: '', location: 'home', requestDate: '',
    customerId: '', customerPhone: '', customerName: '', customerAddress: '', customerArea: '',
    originalCustomerPhone: '',
  });
  const [requestEditError, setRequestEditError] = useState('');
  const [savingRequestEdit, setSavingRequestEdit] = useState(false);
  // Correcting the completion date/notes on an already-marked-done visit —
  // the replacement for the old technician-facing mistake-fix window.
  const [editingCompletionId, setEditingCompletionId] = useState<string | null>(null);
  const [completionEditForm, setCompletionEditForm] = useState({ actualDate: '', notes: '' });
  const [completionEditError, setCompletionEditError] = useState('');
  const [savingCompletionEdit, setSavingCompletionEdit] = useState(false);

  const load = async () => {
    setLoading(true);
    const [callsRes, staffRes, dueRes] = await Promise.all([
      fetch('/api/admin/service-calls'),
      fetch('/api/admin/staff'),
      fetch('/api/admin/service-calls/due'),
    ]);
    const serviceCalls: ServiceCall[] = (await callsRes.json()).serviceCalls ?? [];
    setCalls(serviceCalls);
    setStaff((await staffRes.json()).staff ?? []);
    setDue((await dueRes.json()).due ?? []);

    // Spare parts sold against a completed or closed visit — for the
    // "what's already been recorded" block, right where the admin decides
    // whether to confirm it (or, once closed, might need to correct).
    const completedIds = serviceCalls.filter((c) => c.status === 'completed' || c.status === 'closed').map((c) => c.id);
    const salesEntries = await Promise.all(
      completedIds.map(async (id) => {
        const res = await fetch(`/api/admin/spare-part-sales?ticketId=${id}`);
        return [id, (await res.json()).sales ?? []] as const;
      })
    );
    setSparePartSalesByTicket(Object.fromEntries(salesEntries));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (loading) return;
    const targetId = highlightInstallation ? `due-${highlightInstallation}` : highlightTicket ? `call-${highlightTicket}` : null;
    if (!targetId) return;
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [loading, highlightInstallation, highlightTicket]);

  // "New Service" — this installation's yearly follow-up is due this
  // month; requesting it creates the real open ticket, which then shows
  // up below ready to book a tech, same as any other service visit.
  const handleRequestService = async (installationTicketId: string) => {
    if (requestingId) return;
    setError('');
    setRequestingId(installationTicketId);
    const res = await fetch('/api/admin/service-calls/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationTicketId }),
    });
    setRequestingId(null);
    if (!res.ok) return setError((await res.json()).error);
    load();
  };

  const handleNewServiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingNew) return; // a fast double-click must never create it twice
    setSubmittingNew(true);
    setNewServiceError('');
    const res = await fetch('/api/admin/service-calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newService),
    });
    setSubmittingNew(false);
    if (!res.ok) {
      setNewServiceError((await res.json()).error ?? 'Failed to create service request');
      return;
    }
    setNewService(emptyNewService);
    setShowNewForm(false);
    load();
  };

  const handleLogCall = async (id: string) => {
    setError('');
    const res = await fetch(`/api/admin/service-calls/${id}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: callNote[id] ?? '' }),
    });
    if (!res.ok) return setError((await res.json()).error);
    setCallNote({ ...callNote, [id]: '' });
    load();
  };

  const handleDecline = async (id: string) => {
    setError('');
    const res = await fetch(`/api/admin/service-calls/${id}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: declineNote[id] ?? '' }),
    });
    if (!res.ok) return setError((await res.json()).error);
    load();
  };

  const handleBook = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    setError('');
    const res = await fetch(`/api/admin/service-calls/${id}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookForm),
    });
    if (!res.ok) return setError((await res.json()).error);
    setBookingId(null);
    load();
  };

  // Reassigning/rescheduling an already-booked call — same endpoint as a
  // fresh booking, pre-filled with what's there now.
  const startEditBooking = (c: ServiceCall) => {
    setError('');
    setBookingId(c.id);
    setBookForm({
      assignedToId: c.assigned_to_id ?? '',
      bookedDate: c.booked_date ?? '',
      bookedHalfDay: c.booked_half_day ?? 'morning',
      location: c.location ?? 'home',
    });
  };

  const handleUnassign = async (id: string) => {
    if (!(await confirm('Put this back to dispatch? It stays a requested service call, just unassigned and unscheduled.'))) return;
    setError('');
    const res = await fetch(`/api/admin/tickets/${id}/unassign`, { method: 'POST' });
    if (!res.ok) return setError((await res.json()).error ?? 'Failed to put back to dispatch');
    load();
  };

  const startEditingRequest = (c: ServiceCall) => {
    setRequestEditError('');
    setEditingRequestId(c.id);
    setRequestEditForm({
      productInterest: c.product_interest ?? '',
      issueNote: c.issue_note ?? '',
      location: c.location ?? 'home',
      requestDate: c.created_at.slice(0, 10),
      customerId: c.customers.id,
      customerPhone: c.customers.phone_number,
      customerName: c.customers.name,
      customerAddress: c.customers.address,
      customerArea: c.customers.area,
      originalCustomerPhone: c.customers.phone_number,
    });
  };

  // Same customer-correction path as Purchases: reuses updateCustomer()
  // (and its own phone-number sheet re-key), separately from the
  // request's own product/issue/location/date fields.
  const handleSaveRequestEdit = async (id: string) => {
    if (savingRequestEdit) return;
    setSavingRequestEdit(true);
    setRequestEditError('');
    const customerRes = await fetch(`/api/admin/customers/${requestEditForm.customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: requestEditForm.customerPhone,
        name: requestEditForm.customerName,
        address: requestEditForm.customerAddress,
        area: requestEditForm.customerArea,
      }),
    });
    if (!customerRes.ok) {
      setSavingRequestEdit(false);
      setRequestEditError((await customerRes.json()).error ?? 'Failed to save customer details');
      return;
    }
    const res = await fetch(`/api/admin/service-calls/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productInterest: requestEditForm.productInterest,
        issueNote: requestEditForm.issueNote,
        location: requestEditForm.location,
        requestDate: requestEditForm.requestDate,
      }),
    });
    setSavingRequestEdit(false);
    if (!res.ok) {
      setRequestEditError((await res.json()).error ?? 'Failed to save');
      return;
    }
    setEditingRequestId(null);
    load();
  };

  const startEditingCompletion = (c: ServiceCall) => {
    setCompletionEditError('');
    setEditingCompletionId(c.id);
    setCompletionEditForm({ actualDate: c.actual_date ?? todayIST(), notes: c.actual_notes ?? '' });
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
    setEditingCompletionId(null);
    load();
  };

  const activeCalls = calls.filter((c) => c.status !== 'closed');
  const closedCalls = calls.filter((c) => c.status === 'closed');

  return (
    <AppShell title="Services">
    <div className="max-w-5xl mx-auto">
      {confirmDialog}
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1 mt-2">
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewForm((s) => !s)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white"
          >
            {showNewForm ? 'Cancel' : '+ New Service'}
          </button>
        </div>
      </div>
      <p className="text-sm text-ink-2 mb-6">
        Yearly service is due every 18 months, then every 12 after that (§8.2) — newest
        installation first. "+ New Service" is for a customer calling in with a problem any
        time, not tied to that schedule.
      </p>
      {error && !showNewForm && <p className="text-danger bg-danger-tint p-3 rounded mb-4">{error}</p>}

      {showNewForm && (
        <form onSubmit={handleNewServiceSubmit} className="bg-surface p-4 rounded-lg shadow-sm border border-rule mb-8 space-y-3">
          {newServiceError && <p className="text-danger text-sm">{newServiceError}</p>}
          <CustomerFields
            value={{
              phoneNumber: newService.phoneNumber,
              name: newService.name,
              address: newService.address,
              area: newService.area,
              customerId: newService.customerId,
              forceNewAddress: newService.forceNewAddress,
            }}
            onChange={(v) => setNewService({ ...newService, ...v })}
          />
          <FormRow label="Product">
            <select
              className="w-full border rounded px-3 py-2 text-ink"
              value={newService.productInterest}
              onChange={(e) => setNewService({ ...newService, productInterest: e.target.value })}
            >
              <option value="">(not sure yet)</option>
              <option value="Kitchen">Kitchen</option>
              <option value="Vessel">Vessel</option>
              <option value="Commercial">Commercial</option>
            </select>
          </FormRow>
          <FormRow label="Problem" required>
            <input
              required
              placeholder="e.g. 'Water not working'"
              className="w-full border rounded px-3 py-2 text-ink"
              value={newService.issueNote}
              onChange={(e) => setNewService({ ...newService, issueNote: e.target.value })}
            />
          </FormRow>
          <FormRow label="Assign to Staff">
            <select
              className="w-full border rounded px-3 py-2 text-ink"
              value={newService.staffAttendedId}
              onChange={(e) => {
                const staffAttendedId = e.target.value;
                // Picking someone books it immediately — default to right
                // now, but leave date/time editable below for a visit
                // already done earlier, or one planned for later today.
                setNewService((prev) => ({
                  ...prev,
                  staffAttendedId,
                  bookedDate: staffAttendedId && !prev.bookedDate ? todayIST() : prev.bookedDate,
                  bookedHalfDay: staffAttendedId && !prev.bookedDate ? currentHalfDay() : prev.bookedHalfDay,
                }));
              }}
            >
              <option value="">(not yet decided)</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormRow>
          {newService.staffAttendedId && (
            <FormRow label="Date & Time">
              <div className="flex gap-2">
                <input
                  type="date"
                  required
                  className="flex-1 border rounded px-3 py-2 text-ink"
                  value={newService.bookedDate}
                  onChange={(e) => setNewService({ ...newService, bookedDate: e.target.value })}
                />
                <select
                  className="border rounded px-3 py-2 text-ink"
                  value={newService.bookedHalfDay}
                  onChange={(e) => setNewService({ ...newService, bookedHalfDay: e.target.value })}
                >
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </FormRow>
          )}
          <FormRow label="Location">
            <select
              className="w-full border rounded px-3 py-2 text-ink"
              value={newService.location}
              onChange={(e) => setNewService({ ...newService, location: e.target.value })}
            >
              <option value="home">Home</option>
              <option value="office">Office</option>
            </select>
          </FormRow>
          <button
            type="submit"
            disabled={submittingNew}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white disabled:opacity-50"
          >
            {submittingNew ? 'Creating...' : 'Create service request'}
          </button>
        </form>
      )}

      <h2 className="text-lg font-semibold mb-2">Due this month</h2>
      {loading ? (
        <p className="mb-6">Loading...</p>
      ) : due.length === 0 ? (
        <p className="text-ink mb-6">Nothing due this month.</p>
      ) : (
        <div className="bg-surface rounded-lg shadow-sm border border-rule divide-y mb-8">
          {due.map((d) => (
            <div
              key={d.installationTicketId}
              id={`due-${d.installationTicketId}`}
              className={`p-4 flex justify-between items-center ${
                highlightInstallation === d.installationTicketId ? 'bg-warn-tint ring-2 ring-inset ring-warn' : ''
              }`}
            >
              <div>
                <p className="font-medium">
                  {d.customerName} — {d.phoneNumber}
                </p>
                <p className="text-sm text-ink-2">
                  {d.area} · {d.productLabel || 'No product noted'} · installed{' '}
                  {(d.monthsSinceInstall / 12).toFixed(1)} years ago
                </p>
              </div>
              <button
                onClick={() => handleRequestService(d.installationTicketId)}
                disabled={requestingId === d.installationTicketId}
                className="px-3 py-1.5 bg-ok hover:opacity-90 text-white text-sm disabled:opacity-50 whitespace-nowrap"
              >
                {requestingId === d.installationTicketId ? 'Requesting...' : 'Mark service requested'}
              </button>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-lg font-semibold mb-2">Requested — booking or in progress</h2>
      {loading ? (
        <p>Loading...</p>
      ) : activeCalls.length === 0 ? (
        <p className="text-ink">No yearly service calls due right now.</p>
      ) : (
        <div className="space-y-4">
          {activeCalls.map((c) => (
            <div
              key={c.id}
              id={`call-${c.id}`}
              className={`bg-surface rounded-lg shadow-sm border border-rule p-4 ${
                highlightTicket === c.id ? 'ring-2 ring-warn' : ''
              }`}
            >
              <p className="font-medium">
                {c.customers.name} — {c.customers.phone_number}
              </p>
              <p className="text-sm text-ink-2">
                {c.customers.address}, {c.customers.area}
              </p>
              <p className="text-sm mt-1">
                Status: <span className="font-medium capitalize">{c.status}</span>
                {c.booked_date && (
                  <>
                    {' · '}
                    {c.booked_date} ({c.booked_half_day}) · {c.location} · assigned to {c.users?.name}
                  </>
                )}
                {!c.parent_installation_id && ['open', 'booked'].includes(c.status) && (
                  <button
                    onClick={() => (editingRequestId === c.id ? setEditingRequestId(null) : startEditingRequest(c))}
                    className="ml-2 text-accent-deep hover:underline"
                  >
                    {editingRequestId === c.id ? 'Cancel edit' : 'Edit request'}
                  </button>
                )}
              </p>

              {editingRequestId === c.id && (
                <div className="mt-2 pt-2 border-t space-y-2">
                  {requestEditError && <p className="text-danger text-xs">{requestEditError}</p>}
                  <input
                    type="date"
                    required
                    max={todayIST()}
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={requestEditForm.requestDate}
                    onChange={(e) => setRequestEditForm({ ...requestEditForm, requestDate: e.target.value })}
                  />
                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={requestEditForm.productInterest}
                    onChange={(e) => setRequestEditForm({ ...requestEditForm, productInterest: e.target.value })}
                  >
                    <option value="">(not sure yet)</option>
                    <option value="Kitchen">Kitchen</option>
                    <option value="Vessel">Vessel</option>
                    <option value="Commercial">Commercial</option>
                  </select>
                  <input
                    required
                    placeholder="Reported problem"
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={requestEditForm.issueNote}
                    onChange={(e) => setRequestEditForm({ ...requestEditForm, issueNote: e.target.value })}
                  />
                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={requestEditForm.location}
                    onChange={(e) => setRequestEditForm({ ...requestEditForm, location: e.target.value })}
                  >
                    <option value="home">Home</option>
                    <option value="office">Office</option>
                  </select>

                  <p className="text-xs text-ink-2 pt-1">Customer details</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      required
                      placeholder="Phone number"
                      className="border rounded px-3 py-2 text-sm"
                      value={requestEditForm.customerPhone}
                      onChange={(e) => setRequestEditForm({ ...requestEditForm, customerPhone: e.target.value })}
                    />
                    <input
                      required
                      placeholder="Name"
                      className="border rounded px-3 py-2 text-sm"
                      value={requestEditForm.customerName}
                      onChange={(e) => setRequestEditForm({ ...requestEditForm, customerName: e.target.value.toUpperCase() })}
                    />
                    <input
                      required
                      placeholder="Address"
                      className="border rounded px-3 py-2 text-sm"
                      value={requestEditForm.customerAddress}
                      onChange={(e) => setRequestEditForm({ ...requestEditForm, customerAddress: e.target.value })}
                    />
                    <AreaSelect
                      required
                      value={requestEditForm.customerArea}
                      onChange={(area) => setRequestEditForm({ ...requestEditForm, customerArea: area })}
                    />
                  </div>
                  {requestEditForm.customerPhone.trim() !== requestEditForm.originalCustomerPhone && (
                    <p className="text-xs text-warn">
                      Changing the phone number also renames this customer&apos;s existing Sales/Service/Enquiry
                      sheet rows to match, so future syncs keep finding them.
                    </p>
                  )}

                  <button
                    onClick={() => handleSaveRequestEdit(c.id)}
                    disabled={savingRequestEdit}
                    className="px-4 py-2 bg-accent text-white rounded-md text-sm hover:bg-accent-hover disabled:opacity-50"
                  >
                    {savingRequestEdit ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              )}

              {c.status === 'open' && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <div className="flex gap-2">
                    <input
                      placeholder="Call: does the customer need service?"
                      className="flex-1 border rounded px-3 py-2 text-sm"
                      value={callNote[c.id] ?? ''}
                      onChange={(e) => setCallNote({ ...callNote, [c.id]: e.target.value })}
                    />
                    <button
                      onClick={() => handleLogCall(c.id)}
                      className="px-3 py-2 border rounded-md text-sm"
                    >
                      Log call
                    </button>
                  </div>

                  <div className="flex gap-2 items-center">
                    <button
                      onClick={() => setBookingId(bookingId === c.id ? null : c.id)}
                      className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover"
                    >
                      Needs service — book it
                    </button>
                    <input
                      placeholder="Why declined?"
                      className="flex-1 border rounded px-3 py-1.5 text-sm"
                      value={declineNote[c.id] ?? ''}
                      onChange={(e) => setDeclineNote({ ...declineNote, [c.id]: e.target.value })}
                    />
                    <button
                      onClick={() => handleDecline(c.id)}
                      className="px-3 py-1.5 border rounded-md text-sm"
                    >
                      Customer declined
                    </button>
                  </div>

                  {bookingId === c.id && (
                    <form onSubmit={(e) => handleBook(e, c.id)} className="pt-3 border-t space-y-2">
                      <BookingForm staff={staff} value={bookForm} onChange={setBookForm} submitLabel="Confirm booking" />
                    </form>
                  )}
                </div>
              )}

              {c.status === 'booked' && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => (bookingId === c.id ? setBookingId(null) : startEditBooking(c))}
                      className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent-tint"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleUnassign(c.id)}
                      className="px-3 py-1.5 border border-danger text-danger rounded-md text-sm hover:bg-danger-tint"
                    >
                      Put back to dispatch
                    </button>
                    <a
                      href={`/admin/spare-parts?new=1&ticketId=${c.id}&kind=service_visit&customerName=${encodeURIComponent(c.customers.name)}&phone=${encodeURIComponent(c.customers.phone_number)}`}
                      className="px-3 py-1.5 bg-sky-400 hover:bg-sky-500 text-ink rounded-md text-sm"
                    >
                      Service completed
                    </a>
                  </div>
                  {bookingId === c.id && (
                    <form onSubmit={(e) => handleBook(e, c.id)} className="pt-3 border-t space-y-2">
                      <BookingForm staff={staff} value={bookForm} onChange={setBookForm} submitLabel="Save changes" />
                    </form>
                  )}
                </div>
              )}

              {c.status === 'completed' && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  {/* A visit still sitting here in 'completed' predates
                      the one-click spares-completion merge (or its
                      immediate close call failed) — no action left to
                      take on it from here, just what was recorded. Spare
                      parts are recorded separately (Sell Spare Part,
                      linked to this ticket), not on the ticket itself. */}
                  <div className="bg-inset rounded-md p-3 text-sm space-y-1">
                    <p>
                      <span className="text-ink-2">Spare parts:</span>{' '}
                      {(sparePartSalesByTicket[c.id] ?? []).length === 0
                        ? '—'
                        : sparePartSalesByTicket[c.id]
                            .map((s) => `${s.part_name} x${s.quantity} (₹${s.total})`)
                            .join(', ')}
                    </p>
                    <p>
                      <span className="text-ink-2">Notes:</span> {c.actual_notes || '—'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && closedCalls.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-2 mt-6">Closed</h2>
          <div className="space-y-4">
            {closedCalls.map((c) => (
              <div key={c.id} className="bg-surface rounded-lg shadow-sm border border-rule p-4">
                <p className="font-medium">
                  {c.customers.name} — {c.customers.phone_number}
                </p>
                <p className="text-sm text-ink-2">
                  {c.customers.address}, {c.customers.area}
                </p>
                <p className="text-sm mt-1">
                  Completed {c.actual_date ?? '—'}
                  {c.users && <> · {c.users.name}</>}
                </p>
                <div className="bg-inset rounded-md p-3 text-sm space-y-1 mt-2">
                  <p>
                    <span className="text-ink-2">Spare parts:</span>{' '}
                    {(sparePartSalesByTicket[c.id] ?? []).length === 0
                      ? '—'
                      : sparePartSalesByTicket[c.id].map((s) => `${s.part_name} x${s.quantity} (₹${s.total})`).join(', ')}
                  </p>
                  <p>
                    <span className="text-ink-2">Notes:</span> {c.actual_notes || '—'}
                  </p>
                </div>
                <button
                  onClick={() => (editingCompletionId === c.id ? setEditingCompletionId(null) : startEditingCompletion(c))}
                  className="mt-2 text-xs text-accent-deep hover:underline"
                >
                  {editingCompletionId === c.id ? 'Cancel edit' : 'Edit completion date/notes'}
                </button>
                {editingCompletionId === c.id && (
                  <div className="mt-2 p-3 border rounded-md space-y-2">
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
                    <button
                      onClick={() => handleSaveCompletionEdit(c.id)}
                      disabled={savingCompletionEdit}
                      className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm disabled:opacity-50"
                    >
                      {savingCompletionEdit ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
    </AppShell>
  );
}
