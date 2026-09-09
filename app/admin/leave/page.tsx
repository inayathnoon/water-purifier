'use client';

import { useEffect, useState } from 'react';
import HomeLink from '@/components/HomeLink';
import { todayIST } from '@/lib/dates';

interface StaffMember {
  id: string;
  name: string;
}

const emptyForm = { staffId: '', startDate: todayIST(), endDate: todayIST(), reason: '' };

// §11.1, filed on a technician's behalf — there's no staff login for them
// to request their own time off any more. An owner still decides
// (§11.3), unchanged, at /owner/leave.
export default function AdminLeavePage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch('/api/admin/staff')
      .then((res) => res.json())
      .then((d) => setStaff(d.staff ?? []));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    setSubmitted(false);
    const res = await fetch('/api/admin/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? 'Failed to request leave');
      return;
    }
    setForm(emptyForm);
    setSubmitted(true);
  };

  return (
    <div className="max-w-md mx-auto py-8 px-4">
      <HomeLink />
      <h1 className="text-2xl font-bold mb-1 mt-2">Request time off</h1>
      <p className="text-sm text-gray-500 mb-6">
        On a technician's behalf — they let you know by phone/Telegram, you log it here. The owner decides.
      </p>

      <form onSubmit={handleSubmit} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 space-y-3">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {submitted && <p className="text-green-700 text-sm">Requested — waiting on the owner's decision.</p>}

        <select
          required
          className="w-full border rounded px-3 py-2 text-gray-900"
          value={form.staffId}
          onChange={(e) => setForm({ ...form, staffId: e.target.value })}
        >
          <option value="">Staff member...</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="date"
            required
            className="border rounded px-3 py-2"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
          <input
            type="date"
            required
            className="border rounded px-3 py-2"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </div>
        <textarea
          required
          placeholder="Reason"
          className="w-full border rounded px-3 py-2"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Requesting...' : 'Request leave'}
        </button>
      </form>
    </div>
  );
}
