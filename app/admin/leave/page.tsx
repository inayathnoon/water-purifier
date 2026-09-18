'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
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
    fetch('/api/admin/staff', { cache: 'no-store' })
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
    <AppShell title="Time off">
      <div className="max-w-[640px]">
        <p className="text-[13px] text-ink-2 mb-4">
          On a technician&apos;s behalf — they let you know by phone/Telegram, you log it here. The owner decides.
        </p>

        <form onSubmit={handleSubmit} className="bg-surface p-4 border border-rule space-y-3">
          {error && <p className="text-danger text-[13px]">{error}</p>}
          {submitted && <p className="text-ok text-[13px]">Requested — waiting on the owner&apos;s decision.</p>}

          <div>
            <label className="block text-[13px] font-medium mb-1">Staff member</label>
            <select
              required
              className="w-full h-11 border border-rule rounded-xs px-3 text-ink focus-visible:outline-2 focus-visible:outline-accent"
              value={form.staffId}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            >
              <option value="">Select…</option>
              {/* "Others" isn't a real person to file leave for. */}
              {staff.filter((s) => s.name !== 'Others').map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium mb-1">Start date</label>
              <input
                type="date"
                required
                className="w-full h-11 border border-rule rounded-xs px-3 focus-visible:outline-2 focus-visible:outline-accent"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium mb-1">End date</label>
              <input
                type="date"
                required
                className="w-full h-11 border border-rule rounded-xs px-3 focus-visible:outline-2 focus-visible:outline-accent"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium mb-1">Reason</label>
            <textarea
              required
              placeholder="Reason"
              className="w-full border border-rule rounded-xs px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              {submitting ? 'Requesting…' : 'Request leave'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
