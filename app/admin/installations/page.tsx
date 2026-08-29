'use client';

import { useEffect, useState } from 'react';

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
}

interface StaffMember {
  id: string;
  name: string;
}

export default function InstallationsPage() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookForm, setBookForm] = useState({ assignedToId: '', bookedDate: '', bookedHalfDay: 'morning', location: 'home' });
  const [error, setError] = useState('');

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
      <h1 className="text-2xl font-bold mb-6">Installations</h1>
      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : installations.length === 0 ? (
        <p className="text-gray-500">No installations in progress.</p>
      ) : (
        <div className="space-y-4">
          {installations.map((inst) => (
            <div key={inst.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">
                    {inst.customers.name} — {inst.customers.phone_number}
                  </p>
                  <p className="text-sm text-gray-600">
                    {inst.customers.address}, {inst.customers.area}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Agreed price: ${inst.agreed_price}</p>
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
                      Confirm & close (creates order)
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
                    <p className="text-xs text-gray-500">
                      This person already has {loadFor(bookForm.assignedToId, bookForm.bookedDate, bookForm.bookedHalfDay)} job(s)
                      in this half-day.
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
