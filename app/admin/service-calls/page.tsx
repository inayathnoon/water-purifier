'use client';

import { useEffect, useState } from 'react';

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

export default function ServiceCallsPage() {
  const [calls, setCalls] = useState<ServiceCall[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [callNote, setCallNote] = useState<Record<string, string>>({});
  const [declineNote, setDeclineNote] = useState<Record<string, string>>({});
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookForm, setBookForm] = useState({ assignedToId: '', bookedDate: '', bookedHalfDay: 'morning', location: 'home' });

  const load = async () => {
    setLoading(true);
    const [callsRes, staffRes] = await Promise.all([
      fetch('/api/admin/service-calls'),
      fetch('/api/admin/staff'),
    ]);
    setCalls((await callsRes.json()).serviceCalls ?? []);
    setStaff((await staffRes.json()).staff ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

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
      <h1 className="text-2xl font-bold mb-1">Yearly Service Calls</h1>
      <p className="text-sm text-gray-600 mb-6">
        Created automatically one year after each installation (§8.2) — nobody has to remember.
      </p>
      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : calls.length === 0 ? (
        <p className="text-gray-600">No yearly service calls due right now.</p>
      ) : (
        <div className="space-y-4">
          {calls.map((c) => (
            <div key={c.id} className="bg-white rounded-lg shadow p-4">
              <p className="font-medium">
                {c.customers.name} — {c.customers.phone_number}
              </p>
              <p className="text-sm text-gray-600">
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
                    charge: {c.charge_amount != null ? `$${c.charge_amount}` : '—'}
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
