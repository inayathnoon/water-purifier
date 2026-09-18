'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';

interface LeaveRequest {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  decision_reason: string | null;
  users: { name: string };
}

export default function OwnerLeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/owner/leave', { cache: 'no-store' });
    const data = await res.json();
    setRequests(data.requests ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (id: string, decision: 'approved' | 'denied', reason?: string) => {
    setError('');
    const res = await fetch(`/api/owner/leave/${id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, reason }),
    });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setDenyingId(null);
    setDenyReason('');
    load();
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  return (
    <AppShell title="Time off">
    <div className="max-w-3xl mx-auto">
      {error && <p className="text-danger bg-danger-tint p-3 rounded mb-4">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <h2 className="font-semibold mb-3">Pending ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="text-ink mb-6">Nothing waiting on you.</p>
          ) : (
            <div className="space-y-3 mb-8">
              {pending.map((r) => (
                <div key={r.id} className="bg-surface rounded-lg shadow-sm border border-rule p-4">
                  <p className="font-medium">{r.users.name}</p>
                  <p className="text-sm text-ink-2">
                    {r.start_date} to {r.end_date}
                  </p>
                  <p className="text-sm text-ink-2 mt-1">{r.reason}</p>

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => decide(r.id, 'approved')}
                      className="px-3 py-1.5 bg-ok hover:opacity-90 text-white text-sm"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setDenyingId(denyingId === r.id ? null : r.id)}
                      className="px-3 py-1.5 border rounded-md text-sm"
                    >
                      Deny
                    </button>
                  </div>

                  {denyingId === r.id && (
                    <div className="mt-3 pt-3 border-t flex gap-2">
                      <input
                        placeholder="Reason for denying (§11.4 — required)"
                        className="flex-1 border rounded px-3 py-2 text-sm"
                        value={denyReason}
                        onChange={(e) => setDenyReason(e.target.value)}
                      />
                      <button
                        onClick={() => decide(r.id, 'denied', denyReason)}
                        className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700"
                      >
                        Confirm deny
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <h2 className="font-semibold mb-3">Decided</h2>
          {decided.length === 0 ? (
            <p className="text-ink">Nothing yet.</p>
          ) : (
            <div className="space-y-2">
              {decided.map((r) => (
                <div key={r.id} className="bg-surface rounded-lg shadow-sm border border-rule p-3 text-sm">
                  <p>
                    <span className="font-medium">{r.users.name}</span> — {r.start_date} to {r.end_date} —{' '}
                    <span className={r.status === 'approved' ? 'text-ok' : 'text-danger'}>{r.status}</span>
                  </p>
                  {r.decision_reason && <p className="text-ink mt-1">{r.decision_reason}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
    </AppShell>
  );
}
