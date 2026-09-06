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
  installation_date: string | null;
  actual_date: string | null;
  actual_notes: string | null;
  parts_used: string | null;
  charge_amount: number | null;
  // Only ever set on an ad-hoc Service Call — null for an installation or
  // a Yearly Service visit, which is the whole fix: no more guessing from
  // kind/lineage whether there's an actual complaint to show (2026-09-06).
  issue_note: string | null;
  customers: { name: string; address: string; area: string; phone_number: string };
}

// "My last 30 days" — a plain record of completed work, no revenue
// figures (§13.4). charge_amount is a tech's own recorded amount for a
// chargeable visit, not the sale price — already something they entered.
interface HistoryEntry {
  id: string;
  kind: 'installation' | 'service_visit';
  actual_date: string | null;
  actual_notes: string | null;
  parts_used: string | null;
  charge_amount: number | null;
  customers: { name: string };
}

interface SparePart {
  name: string;
  price: number;
}

// Matches "Service Charge", "Service charges", "SERVICE CHARGE", etc. —
// whatever the sheet actually calls it, as long as it starts with those
// two words. An exact-string match here silently missed the real row
// once, since the sheet has it as "Service charges" (plural).
function isServiceCharge(p: SparePart): boolean {
  return p.name.trim().toLowerCase().startsWith('service charge');
}

// Mirrors completeJob()'s own isWithinWarranty() server-side — used here
// only to decide whether to show the spare-parts picker at all, since
// §13.3 forces the actual charge to 0 inside warranty regardless of what
// gets sent, and there's no point asking a tech to build a total that's
// guaranteed to evaporate.
function isWithinWarranty(installationDate: string | null, checkDate: string): boolean {
  if (!installationDate) return false;
  const oneYearLater = new Date(installationDate);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  return new Date(checkDate) <= oneYearLater;
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

function reportedIssue(job: Job): string | null {
  return job.issue_note?.trim() || null;
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
  // Whether the open form is a fresh "Mark Done" or a correction to an
  // already-completed/closed visit (§8.4's mistake-fix window).
  const [formMode, setFormMode] = useState<'complete' | 'edit'>('complete');
  const [form, setForm] = useState({
    actualDate: todayISO(),
    actualStartTime: '',
    actualEndTime: '',
    notes: '',
  });
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [partQuantities, setPartQuantities] = useState<Record<string, number>>({});
  // A one-off fallback for anything not in the sheet's list — a free-text
  // name and its own price, added straight into the total alongside
  // whatever's picked from the regular list.
  const [customPart, setCustomPart] = useState({ name: '', price: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((u) => !cancelled && setUser(u));
    fetch('/api/staff/jobs')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setJobs(data.jobs ?? []);
        setHistory(data.history ?? []);
        setLoading(false);
      });
    fetch('/api/staff/spare-parts')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        // Service Charge (default-on) shown first, everything else after.
        const parts: SparePart[] = data.parts ?? [];
        setSpareParts([...parts.filter(isServiceCharge), ...parts.filter((p) => !isServiceCharge(p))]);
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

  const defaultPartQuantities = (): Record<string, number> => {
    // Service Charge is on by default — every out-of-warranty visit has a
    // base charge unless a tech actively removes it — while every other
    // part starts at 0 and has to be added deliberately.
    const defaults: Record<string, number> = {};
    for (const p of spareParts) {
      if (isServiceCharge(p)) defaults[p.name] = 1;
    }
    return defaults;
  };

  const startCompleting = (job: Job) => {
    setError('');
    setFormMode('complete');
    setCompletingId(job.id);
    setPartQuantities(defaultPartQuantities());
    setCustomPart({ name: '', price: '' });
    const times = HALF_DAY_TIMES[job.booked_half_day] ?? { start: '', end: '' };
    setForm({
      actualDate: todayISO(),
      actualStartTime: times.start,
      actualEndTime: times.end,
      notes: '',
    });
  };

  // §8.4 mistake-fix window: reopen a service visit's own completion form
  // to correct notes/parts/charge — the visit's own actual_date stays
  // fixed (that's what the warranty check re-runs against, same as the
  // first time), only the picker resets fresh since there's no reliable
  // way to reconstruct quantities back out of the saved summary string.
  const startEditing = (job: Job) => {
    setError('');
    setFormMode('edit');
    setCompletingId(job.id);
    setPartQuantities(defaultPartQuantities());
    setCustomPart({ name: '', price: '' });
    setForm({
      actualDate: job.actual_date ?? todayISO(),
      actualStartTime: '',
      actualEndTime: '',
      notes: job.actual_notes ?? '',
    });
  };

  const adjustPartQty = (name: string, delta: number) => {
    setPartQuantities((prev) => {
      const next = Math.max(0, (prev[name] ?? 0) + delta);
      return { ...prev, [name]: next };
    });
  };

  const customPartPrice = Number(customPart.price) || 0;
  const sparePartsTotal =
    spareParts.reduce((sum, p) => sum + (partQuantities[p.name] ?? 0) * p.price, 0) +
    (customPart.name.trim() ? customPartPrice : 0);

  const handleSubmitForm = async (job: Job) => {
    setError('');
    setSubmitting(true);
    const chargeable = job.kind === 'service_visit' && !isWithinWarranty(job.installation_date, form.actualDate);
    const selectedParts = spareParts.filter((p) => (partQuantities[p.name] ?? 0) > 0);
    const partsUsedParts = selectedParts.map((p) => `${p.name} x${partQuantities[p.name]}`);
    if (customPart.name.trim()) partsUsedParts.push(`${customPart.name.trim()} (₹${customPartPrice})`);
    const partsUsed = partsUsedParts.join(', ');
    // Structured mirror of the same picks — lets a revenue report split
    // spare-parts money from the flat service-charge line without having
    // to parse the free-text partsUsed summary above.
    const chargeBreakdown = [
      ...selectedParts.map((p) => ({
        name: p.name,
        quantity: partQuantities[p.name],
        unitPrice: p.price,
        total: partQuantities[p.name] * p.price,
        isServiceCharge: isServiceCharge(p),
      })),
      ...(customPart.name.trim()
        ? [{ name: customPart.name.trim(), quantity: 1, unitPrice: customPartPrice, total: customPartPrice, isServiceCharge: false }]
        : []),
    ];

    const endpoint =
      formMode === 'edit' ? `/api/staff/jobs/${job.id}/edit` : `/api/staff/jobs/${job.id}/complete`;
    const body =
      formMode === 'edit'
        ? {
            notes: form.notes,
            partsUsed: chargeable ? partsUsed : undefined,
            chargeAmount: chargeable ? sparePartsTotal : undefined,
            chargeBreakdown: chargeable ? chargeBreakdown : undefined,
          }
        : {
            ...form,
            partsUsed: chargeable ? partsUsed : undefined,
            chargeAmount: chargeable ? sparePartsTotal : undefined,
            chargeBreakdown: chargeable ? chargeBreakdown : undefined,
          };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
      {user?.role === 'developer' && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 text-sm text-center py-2 rounded mb-3">
          Previewing as staff —{' '}
          <Link href="/developer" className="underline font-medium">
            back to Developer panel
          </Link>
        </div>
      )}
      <div className="flex justify-between items-center gap-2">
        <span className="text-sm text-gray-500">{user?.name}</span>
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
      <p className="text-sm text-gray-500 mb-4">
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
            <div key={job.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex justify-between items-start mb-2">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${jobBadge(job).classes}`}>
                  {jobBadge(job).label}
                </span>
                <span className="text-sm text-gray-500">
                  {job.booked_date} · {HALF_DAY_LABEL[job.booked_half_day] ?? job.booked_half_day}
                </span>
              </div>

              <p className="font-semibold text-lg leading-tight">{job.customers.name}</p>
              <p className="text-sm text-gray-500">
                {job.location === 'office'
                  ? 'Customer brings unit to office'
                  : `${job.customers.address}, ${job.customers.area}`}
              </p>
              <a href={`tel:${job.customers.phone_number}`} className="text-blue-600 text-sm underline">
                {job.customers.phone_number}
              </a>

              {reportedIssue(job) && (
                <div className="mt-2 bg-orange-50 border border-orange-200 rounded-md px-3 py-2">
                  <p className="text-xs font-medium text-orange-800 uppercase tracking-wide">Reported problem</p>
                  <p className="text-sm text-orange-900">{reportedIssue(job)}</p>
                </div>
              )}

              {job.status === 'booked' && completingId !== job.id && (
                <button
                  onClick={() => startCompleting(job)}
                  className="mt-4 w-full py-4 bg-green-600 text-white rounded-lg font-semibold text-lg active:bg-green-700"
                >
                  Mark Done
                </button>
              )}

              {job.status === 'completed' && job.kind === 'installation' && (
                <p className="mt-3 text-sm text-green-700 font-medium">
                  ✓ Done — waiting on admin to confirm with customer
                </p>
              )}

              {job.kind === 'service_visit' && (job.status === 'completed' || job.status === 'closed') && completingId !== job.id && (
                <div className="mt-3 flex justify-between items-center gap-2">
                  <p className="text-sm text-green-700 font-medium">
                    {job.status === 'completed' ? '✓ Done — waiting on admin' : '✓ Confirmed'}
                  </p>
                  <button
                    onClick={() => startEditing(job)}
                    className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50 whitespace-nowrap"
                  >
                    Edit
                  </button>
                </div>
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

                  {job.kind === 'service_visit' &&
                    (isWithinWarranty(job.installation_date, form.actualDate) ? (
                      <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        Still under warranty — no charge for this visit.
                      </p>
                    ) : (
                      <div className="border rounded-lg divide-y">
                        {spareParts.length === 0 ? (
                          <p className="text-sm text-gray-500 p-3">No parts loaded — check with admin.</p>
                        ) : (
                          spareParts.map((p) => (
                            <div key={p.name} className="flex justify-between items-center p-3">
                              <div>
                                <p className="text-sm font-medium">{p.name}</p>
                                <p className="text-xs text-gray-500">₹{p.price}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => adjustPartQty(p.name, -1)}
                                  className="w-9 h-9 rounded-full border text-lg font-semibold active:bg-gray-100"
                                >
                                  −
                                </button>
                                <span className="w-5 text-center">{partQuantities[p.name] ?? 0}</span>
                                <button
                                  type="button"
                                  onClick={() => adjustPartQty(p.name, 1)}
                                  className="w-9 h-9 rounded-full border text-lg font-semibold active:bg-gray-100"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                        <div className="flex gap-2 p-3">
                          <input
                            placeholder="Other (not listed)"
                            className="flex-1 border rounded-lg px-3 py-2 text-sm"
                            value={customPart.name}
                            onChange={(e) => setCustomPart({ ...customPart, name: e.target.value })}
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Price"
                            className="w-24 border rounded-lg px-3 py-2 text-sm"
                            value={customPart.price}
                            onChange={(e) => setCustomPart({ ...customPart, price: e.target.value })}
                          />
                        </div>
                      </div>
                    ))}

                  <div className="flex gap-2 pb-16">
                    <button
                      onClick={() => setCompletingId(null)}
                      className="flex-1 py-3 border rounded-lg font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSubmitForm(job)}
                      disabled={submitting}
                      className="flex-[2] py-3 bg-green-600 text-white rounded-lg font-semibold text-lg disabled:opacity-50"
                    >
                      {submitting ? 'Saving...' : formMode === 'edit' ? 'Save Changes' : 'Submit'}
                    </button>
                  </div>

                  {job.kind === 'service_visit' && !isWithinWarranty(job.installation_date, form.actualDate) && (
                    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg px-4 py-3 flex justify-between items-center z-10">
                      <span className="font-medium">Total</span>
                      <span className="text-xl font-bold">₹{sparePartsTotal}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6 pt-4 border-t">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="text-sm text-blue-600 underline"
          >
            {showHistory ? 'Hide' : 'Show'} my last 30 days ({history.length})
          </button>
          {showHistory && (
            <div className="mt-3 space-y-2">
              {history.map((h) => (
                <div key={h.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 text-sm">
                  <div className="flex justify-between items-start">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      h.kind === 'installation' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                    }`}>
                      {h.kind === 'installation' ? 'Installation' : 'Service visit'}
                    </span>
                    <span className="text-gray-900">{h.actual_date}</span>
                  </div>
                  <p className="font-medium mt-1">{h.customers.name}</p>
                  {h.kind === 'service_visit' && (
                    <p className="text-gray-900 mt-1">
                      {h.parts_used ? `Parts: ${h.parts_used}` : 'No parts used'}
                      {h.charge_amount != null && (h.charge_amount > 0 ? ` · ₹${h.charge_amount}` : ' · Free (under warranty)')}
                    </p>
                  )}
                  {h.actual_notes && <p className="text-gray-900 mt-1">{h.actual_notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
