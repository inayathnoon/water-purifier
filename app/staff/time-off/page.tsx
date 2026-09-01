'use client';

import { useEffect, useState } from 'react';
import HomeLink from '@/components/HomeLink';

interface LeaveRequest {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  decision_reason: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
};

export default function TimeOffPage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ startDate: '', endDate: '', reason: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/staff/leave');
    const data = await res.json();
    setRequests(data.requests ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // a fast double-tap on Request leave must never send it twice
    setError('');
    setSubmitting(true);
    const res = await fetch('/api/staff/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setForm({ startDate: '', endDate: '', reason: '' });
    load();
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <HomeLink />
      <h1 className="text-2xl font-bold mb-6 mt-2">Time Off</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 mb-6 space-y-3">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex gap-2">
          <input
            type="date"
            required
            className="flex-1 border rounded px-3 py-2"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
          <input
            type="date"
            required
            className="flex-1 border rounded px-3 py-2"
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
          disabled={submitting}
          className="w-full py-3 bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
        >
          {submitting ? 'Sending...' : 'Request leave'}
        </button>
      </form>

      <h2 className="font-semibold mb-3">My requests</h2>
      {loading ? (
        <p>Loading...</p>
      ) : requests.length === 0 ? (
        <p className="text-gray-900">No requests yet.</p>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">
                    {r.start_date} to {r.end_date}
                  </p>
                  <p className="text-sm text-gray-900 mt-1">{r.reason}</p>
                  {r.status === 'denied' && r.decision_reason && (
                    <p className="text-sm text-red-600 mt-1">Reason: {r.decision_reason}</p>
                  )}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
