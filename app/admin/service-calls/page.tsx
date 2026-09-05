'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import HomeLink from '@/components/HomeLink';
import CustomerFields from '@/components/CustomerFields';

// Label on the left, the field on the right — matches FormRow elsewhere.
function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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

interface ServiceCall {
  id: string;
  status: 'open' | 'booked' | 'completed';
  booked_date: string | null;
  booked_half_day: string | null;
  location: string | null;
  charge_amount: number | null;
  parts_used: string | null;
  customers: { name: string; phone_number: string; address: string; area: string };
  users: { name: string } | null;
}

interface StaffMember {
  id: string;
  name: string;
  approvedLeave: { start_date: string; end_date: string }[];
}

function onApprovedLeave(staff: StaffMember[], staffId: string, date: string): boolean {
  if (!date) return false;
  const person = staff.find((s) => s.id === staffId);
  return (person?.approvedLeave ?? []).some((l) => date >= l.start_date && date <= l.end_date);
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

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

  const load = async () => {
    setLoading(true);
    const [callsRes, staffRes, dueRes] = await Promise.all([
      fetch('/api/admin/service-calls'),
      fetch('/api/admin/staff'),
      fetch('/api/admin/service-calls/due'),
    ]);
    setCalls((await callsRes.json()).serviceCalls ?? []);
    setStaff((await staffRes.json()).staff ?? []);
    setDue((await dueRes.json()).due ?? []);
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

  const handleConfirmClose = async (id: string) => {
    setError('');
    const res = await fetch(`/api/admin/tickets/${id}/close`, { method: 'POST' });
    if (!res.ok) return setError((await res.json()).error);
    load();
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <HomeLink />
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1 mt-2">
        <h1 className="text-2xl font-bold">Services</h1>
        <button
          onClick={() => setShowNewForm((s) => !s)}
          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
        >
          {showNewForm ? 'Cancel' : '+ New Service'}
        </button>
      </div>
      <p className="text-sm text-gray-900 mb-6">
        Yearly service is due every 18 months, then every 12 after that (§8.2) — newest
        installation first. "+ New Service" is for a customer calling in with a problem any
        time, not tied to that schedule.
      </p>
      {error && !showNewForm && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {showNewForm && (
        <form onSubmit={handleNewServiceSubmit} className="bg-white p-4 rounded-lg shadow mb-8 space-y-3">
          {newServiceError && <p className="text-red-600 text-sm">{newServiceError}</p>}
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
              className="w-full border rounded px-3 py-2 text-gray-900"
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
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={newService.issueNote}
              onChange={(e) => setNewService({ ...newService, issueNote: e.target.value })}
            />
          </FormRow>
          <FormRow label="Staff Attended">
            <select
              className="w-full border rounded px-3 py-2 text-gray-900"
              value={newService.staffAttendedId}
              onChange={(e) => {
                const staffAttendedId = e.target.value;
                // Picking someone books it immediately — default to right
                // now, but leave date/time editable below for a visit
                // already done earlier, or one planned for later today.
                setNewService((prev) => ({
                  ...prev,
                  staffAttendedId,
                  bookedDate: staffAttendedId && !prev.bookedDate ? todayISO() : prev.bookedDate,
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
                  className="flex-1 border rounded px-3 py-2 text-gray-900"
                  value={newService.bookedDate}
                  onChange={(e) => setNewService({ ...newService, bookedDate: e.target.value })}
                />
                <select
                  className="border rounded px-3 py-2 text-gray-900"
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
              className="w-full border rounded px-3 py-2 text-gray-900"
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
            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
          >
            {submittingNew ? 'Creating...' : 'Create service request'}
          </button>
        </form>
      )}

      <h2 className="text-lg font-semibold mb-2">Due this month</h2>
      {loading ? (
        <p className="mb-6">Loading...</p>
      ) : due.length === 0 ? (
        <p className="text-gray-900 mb-6">Nothing due this month.</p>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y mb-8">
          {due.map((d) => (
            <div
              key={d.installationTicketId}
              id={`due-${d.installationTicketId}`}
              className={`p-4 flex justify-between items-center ${
                highlightInstallation === d.installationTicketId ? 'bg-yellow-50 ring-2 ring-inset ring-yellow-400' : ''
              }`}
            >
              <div>
                <p className="font-medium">
                  {d.customerName} — {d.phoneNumber}
                </p>
                <p className="text-sm text-gray-900">
                  {d.area} · {d.productLabel || 'No product noted'} · installed{' '}
                  {(d.monthsSinceInstall / 12).toFixed(1)} years ago
                </p>
              </div>
              <button
                onClick={() => handleRequestService(d.installationTicketId)}
                disabled={requestingId === d.installationTicketId}
                className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
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
      ) : calls.length === 0 ? (
        <p className="text-gray-900">No yearly service calls due right now.</p>
      ) : (
        <div className="space-y-4">
          {calls.map((c) => (
            <div
              key={c.id}
              id={`call-${c.id}`}
              className={`bg-white rounded-lg shadow p-4 ${
                highlightTicket === c.id ? 'ring-2 ring-yellow-400' : ''
              }`}
            >
              <p className="font-medium">
                {c.customers.name} — {c.customers.phone_number}
              </p>
              <p className="text-sm text-gray-900">
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
                {c.status === 'completed' && (
                  <>
                    {' · '}
                    charge: {c.charge_amount != null ? `₹${c.charge_amount}` : '—'}
                  </>
                )}
              </p>

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
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
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
                      {onApprovedLeave(staff, bookForm.assignedToId, bookForm.bookedDate) && (
                        <p className="text-xs text-orange-600">
                          This person is on approved leave that day — you can still book them (§11.5).
                        </p>
                      )}
                      <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        Confirm booking
                      </button>
                    </form>
                  )}
                </div>
              )}

              {c.status === 'completed' && (
                <button
                  onClick={() => handleConfirmClose(c.id)}
                  className="mt-3 px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                >
                  Confirm & close
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
