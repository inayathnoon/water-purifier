'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, signOut, type User } from '@/lib/auth';

interface Job {
  id: string;
  kind: 'installation' | 'service_visit';
  status: string;
  booked_date: string;
  booked_half_day: string;
  location: 'home' | 'office';
  parent_installation_id: string | null;
  customers: { name: string; address: string; area: string; phone_number: string };
}

// A service_visit with a parent_installation_id came from the 18-month-and-up
// yearly schedule (§8.2) — everything else (installations, and ad-hoc "New
// Service" calls with no parent) is visually distinct so a tech can tell a
// routine warranty check-up from a customer's own reported problem at a glance.
function jobBadge(job: Job): { label: string; classes: string } {
  if (job.kind === 'installation') return { label: 'Installation', classes: 'bg-blue-100 text-blue-800' };
  if (job.parent_installation_id) return { label: 'Yearly Service', classes: 'bg-purple-100 text-purple-800' };
  return { label: 'Service Call', classes: 'bg-orange-100 text-orange-800' };
}

const HALF_DAY_LABEL: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Exact start/end times aren't worth asking a tech to type on their
// phone — the booked half-day already says roughly when, so completing a
// job just uses a fixed window for whichever half-day it was booked into.
const HALF_DAY_TIMES: Record<string, { start: string; end: string }> = {
  morning: { start: '09:00', end: '12:00' },
  afternoon: { start: '12:00', end: '15:00' },
  evening: { start: '15:00', end: '18:00' },
};

export default function StaffJobsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    actualDate: todayISO(),
    actualStartTime: '',
    actualEndTime: '',
    notes: '',
    partsUsed: '',
    chargeAmount: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((u) => !cancelled && setUser(u));
    fetch('/api/staff/jobs')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setJobs(data.jobs ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth/login');
  };

  const reload = async () => {
    const res = await fetch('/api/staff/jobs');
    const data = await res.json();
    setJobs(data.jobs ?? []);
  };

  const startCompleting = (job: Job) => {
    setError('');
    setCompletingId(job.id);
    const times = HALF_DAY_TIMES[job.booked_half_day] ?? { start: '', end: '' };
    setForm({
      actualDate: todayISO(),
      actualStartTime: times.start,
      actualEndTime: times.end,
      notes: '',
      partsUsed: '',
      chargeAmount: '',
    });
  };

  const handleComplete = async (jobId: string) => {
    setError('');
    setSubmitting(true);
    const res = await fetch(`/api/staff/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        chargeAmount: form.chargeAmount ? Number(form.chargeAmount) : undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setCompletingId(null);
    reload();
  };

  const today = todayISO();
  const visibleJobs = showAll ? jobs : jobs.filter((j) => j.booked_date === today);
  const upcomingCount = jobs.filter((j) => j.booked_date !== today).length;

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 pb-24">
      <div className="flex justify-between items-center gap-2">
        <span className="text-sm text-gray-900">{user?.name}</span>
        <div className="flex items-center gap-3">
          <Link href="/staff/time-off" className="text-sm text-blue-600 hover:underline">
            Time Off
          </Link>
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 text-sm text-gray-900 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </div>
      <h1 className="text-2xl font-bold mb-1 mt-2">My Jobs</h1>
      <p className="text-sm text-gray-900 mb-4">
        {showAll ? 'All jobs' : `Today, ${today}`}
        {!showAll && upcomingCount > 0 && (
          <button onClick={() => setShowAll(true)} className="ml-2 text-blue-600 underline">
            + {upcomingCount} upcoming
          </button>
        )}
        {showAll && (
          <button onClick={() => setShowAll(false)} className="ml-2 text-blue-600 underline">
            Show today only
          </button>
        )}
      </p>

      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4 text-sm">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : visibleJobs.length === 0 ? (
        <p className="text-gray-900 text-center py-12">
          {showAll ? 'No jobs assigned.' : 'No jobs today. Nice.'}
        </p>
      ) : (
        <div className="space-y-4">
          {visibleJobs.map((job) => (
            <div key={job.id} className="bg-white rounded-xl shadow p-4">
              <div className="flex justify-between items-start mb-2">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${jobBadge(job).classes}`}>
                  {jobBadge(job).label}
                </span>
                <span className="text-sm text-gray-900">
                  {job.booked_date} · {HALF_DAY_LABEL[job.booked_half_day] ?? job.booked_half_day}
                </span>
              </div>

              <p className="font-semibold text-lg leading-tight">{job.customers.name}</p>
              <p className="text-gray-900 text-sm">
                {job.location === 'office'
                  ? 'Customer brings unit to office'
                  : `${job.customers.address}, ${job.customers.area}`}
              </p>
              <a href={`tel:${job.customers.phone_number}`} className="text-blue-600 text-sm underline">
                {job.customers.phone_number}
              </a>

              {job.status === 'booked' && completingId !== job.id && (
                <button
                  onClick={() => startCompleting(job)}
                  className="mt-4 w-full py-4 bg-green-600 text-white rounded-lg font-semibold text-lg active:bg-green-700"
                >
                  Mark Done
                </button>
              )}

              {job.status === 'completed' && (
                <p className="mt-3 text-sm text-green-700 font-medium">
                  ✓ Done — waiting on admin to confirm with customer
                </p>
              )}

              {completingId === job.id && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  <textarea
                    placeholder="What did you do?"
                    rows={2}
                    className="w-full border rounded-lg px-3 py-3 text-base"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />

                  {job.kind === 'service_visit' && (
                    <>
                      <input
                        placeholder="Parts used (optional)"
                        className="w-full border rounded-lg px-3 py-3 text-base"
                        value={form.partsUsed}
                        onChange={(e) => setForm({ ...form, partsUsed: e.target.value })}
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Charge amount (leave blank if unsure — system checks warranty automatically)"
                        className="w-full border rounded-lg px-3 py-3 text-base"
                        value={form.chargeAmount}
                        onChange={(e) => setForm({ ...form, chargeAmount: e.target.value })}
                      />
                    </>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setCompletingId(null)}
                      className="flex-1 py-3 border rounded-lg font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleComplete(job.id)}
                      disabled={submitting}
                      className="flex-[2] py-3 bg-green-600 text-white rounded-lg font-semibold text-lg disabled:opacity-50"
                    >
                      {submitting ? 'Saving...' : 'Submit'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
