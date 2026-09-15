'use client';

import { useEffect, useMemo, useState } from 'react';
import { daysAgoIST, enquiryUrgency, todayIST } from '@/lib/dates';
import { toStartCase, formatINR } from '@/lib/format';
import BookingForm from '@/components/BookingForm';
import WeekSchedule from '@/components/dashboard/WeekSchedule';
import { DashboardCard, StaffMember, emptyAssignForm, TypeTag, Tone } from './shared';

const daysAgo = daysAgoIST;

interface AdminDashboardData {
  newEnquiries: { id: string; created_at: string; last_call_at: string | null; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
  oldEnquiryCount: number;
  jobsToDispatch: { id: string; kind: string; created_at: string; enquiry_product_interest: string; customers: { name: string; phone_number: string; area: string } }[];
  overdueDispatchCount: number;
  dueForMarkDone: { id: string; kind: string; booked_date: string; spares_confirmed: boolean; customers: { name: string; phone_number: string } }[];
  overdueMarkDoneCount: number;
  serviceCallsDue: {
    installationTicketId: string;
    customerName: string;
    phoneNumber: string;
    area: string;
    installationDate: string;
    monthsSinceInstall: number;
    productLabel: string | null;
  }[];
  paymentsOutstanding: { name: string; phoneNumber: string; totalBalance: number; orderCount: number; oldestInstallationDate: string | null }[];
  overdueCallCount: number;
  weekJobs: {
    id: string;
    kind: string;
    status: string;
    booked_date: string;
    booked_half_day: string;
    location: 'home' | 'office';
    assigned_to_id: string | null;
    customers: { name: string };
  }[];
  scheduleDays: string[];
}

type FilterGroup = 'dispatch' | 'enquiry' | 'closeout' | 'payment';

// One unified row shape the whole "Needs you today" queue is built from —
// every source list (dispatch, enquiries, close-outs, yearly service,
// payments) reduces to this so they can share one sort and one filter set.
interface QueueRow {
  key: string;
  group: FilterGroup;
  kind: string;
  primary: string;
  secondary: string;
  ageDays: number;
  ageLabel: string;
  ageTone: Tone;
  // Sort priority for the "All" view specifically — Dispatch, Installation,
  // Service visit, Payment, Enquiry (not by age across the whole queue) —
  // a real dispatch/install/service/payment mix reads clearer grouped by
  // what kind of thing it is than shuffled by age.
  priority: number;
  render: () => React.ReactNode;
}

const PRIORITY = {
  dispatch: 0,
  installation: 1,
  service_visit: 2,
  payment: 4,
  enquiry: 5,
} as const;

const FILTERS: { key: FilterGroup | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'enquiry', label: 'Enquiries' },
  { key: 'closeout', label: 'Close-outs' },
  { key: 'payment', label: 'Payments' },
];

export default function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [filter, setFilter] = useState<FilterGroup | 'all'>('all');
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState(emptyAssignForm());
  const [assignError, setAssignError] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [markingDoneId, setMarkingDoneId] = useState<string | null>(null);
  const [markDoneError, setMarkDoneError] = useState('');
  // Installation completed — an inline date panel (defaults to today,
  // editable to an earlier date) instead of a plain yes/no confirm.
  const [installConfirmId, setInstallConfirmId] = useState<string | null>(null);
  const [installConfirmDate, setInstallConfirmDate] = useState(todayIST());

  const loadDashboard = () => {
    fetch('/api/admin/dashboard')
      .then((res) => res.json())
      .then(setData);
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/dashboard')
      .then((res) => res.json())
      .then((d) => !cancelled && setData(d));
    fetch('/api/admin/staff')
      .then((res) => res.json())
      .then((d) => !cancelled && setStaff(d.staff ?? []));
    return () => {
      cancelled = true;
    };
  }, []);

  const startAssigning = (id: string) => {
    setAssignError('');
    setEditingJobId(null);
    setAssigningId(id);
    setAssignForm(emptyAssignForm());
  };

  const startEditingJob = (job: AdminDashboardData['weekJobs'][number]) => {
    setAssignError('');
    setAssigningId(null);
    setEditingJobId(job.id);
    setAssignForm({
      assignedToId: job.assigned_to_id ?? '',
      bookedDate: job.booked_date,
      bookedHalfDay: job.booked_half_day,
      location: job.location,
    });
  };

  const handleAssign = async (e: React.FormEvent, job: { id: string; kind: string }) => {
    e.preventDefault();
    setAssignError('');
    setAssigning(true);
    const endpoint = job.kind === 'installation' ? `/api/admin/installations/${job.id}/book` : `/api/admin/service-calls/${job.id}/book`;
    const payload = job.kind === 'installation' ? { ...assignForm, location: 'home' } : assignForm;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setAssigning(false);
    if (!res.ok) {
      setAssignError((await res.json()).error ?? 'Failed to assign');
      return;
    }
    setAssigningId(null);
    setEditingJobId(null);
    loadDashboard();
  };

  // Installation completed used to be two separate clicks — mark done,
  // then a second "Called & confirmed" once the admin had actually made
  // that call. Business call: fold them into one — clicking "Installation
  // completed" opens an inline date panel (today by default, editable to
  // an earlier date for a job confirmed a day or two late) and, on
  // confirm, marks the job done and immediately closes it in the same
  // action — no lingering unconfirmed installation waiting on a second
  // click. (Service visits already work this way too — completing the
  // spares step there doubles as the completion click.)
  const startInstallConfirm = (ticketId: string) => {
    setMarkDoneError('');
    setInstallConfirmId(ticketId);
    setInstallConfirmDate(todayIST());
  };

  const handleConfirmInstallDone = async (ticketId: string) => {
    setMarkDoneError('');
    setMarkingDoneId(ticketId);
    const res = await fetch(`/api/admin/tickets/${ticketId}/mark-done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actualDate: installConfirmDate }),
    });
    if (!res.ok) {
      setMarkingDoneId(null);
      setMarkDoneError((await res.json()).error ?? 'Failed to mark done');
      return;
    }
    const closeRes = await fetch(`/api/admin/tickets/${ticketId}/close`, { method: 'POST' });
    setMarkingDoneId(null);
    setInstallConfirmId(null);
    if (!closeRes.ok) {
      setMarkDoneError((await closeRes.json()).error ?? 'Marked done, but confirming failed — try again below.');
      loadDashboard();
      return;
    }
    loadDashboard();
  };

  const sellSparePartHref = (t: { id: string; kind: string; customers: { name: string; phone_number: string } }) =>
    `/admin/spare-parts?new=1&ticketId=${t.id}&kind=${t.kind}` +
    `&customerName=${encodeURIComponent(t.customers.name)}&phone=${encodeURIComponent(t.customers.phone_number)}`;

  // Build one queue from every source list — this is the "Needs you
  // today" merge (§7.2): dispatch, enquiries, close-outs (due/job/
  // satisfaction + yearly service), payments.
  const rows: QueueRow[] = useMemo(() => {
    if (!data) return [];
    const out: QueueRow[] = [];

    for (const t of data.jobsToDispatch) {
      const age = daysAgo(t.created_at);
      out.push({
        key: `dispatch-${t.id}`,
        group: 'dispatch',
        kind: t.kind,
        primary: toStartCase(t.customers.name),
        secondary: [t.enquiry_product_interest, t.customers.area].filter(Boolean).map(toStartCase).join(' · ') || t.customers.phone_number,
        ageDays: age,
        ageLabel: age >= 3 ? `${age}d overdue` : `${age}d open`,
        ageTone: age >= 3 ? 'danger' : 'neutral',
        priority: PRIORITY.dispatch,
        render: () => (
          <div key={t.id} className="py-3 border-b border-divider last:border-0">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold truncate flex items-center gap-1.5">
                  <TypeTag kind={t.kind} />
                  {toStartCase(t.customers.name)}
                </p>
                <p className="text-[13px] text-ink-2 truncate">
                  {[t.enquiry_product_interest, t.customers.area].filter(Boolean).map(toStartCase).join(' · ') || t.customers.phone_number}
                </p>
              </div>
              <span className={`text-[13px] font-medium shrink-0 ${age >= 3 ? 'text-danger' : 'text-ink-2'}`}>
                {age >= 3 ? `${age}d overdue` : `${age}d open`}
              </span>
              <button
                onClick={() => (assigningId === t.id ? setAssigningId(null) : startAssigning(t.id))}
                className="shrink-0 px-3 py-1.5 border border-rule text-[13px] font-semibold hover:bg-accent-tint focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                Assign
              </button>
            </div>
            {assigningId === t.id && (
              <form onSubmit={(e) => handleAssign(e, t)} className="mt-3 pt-3 border-t border-divider space-y-2">
                {assignError && <p className="text-danger text-[13px]">{assignError}</p>}
                <BookingForm
                  staff={staff}
                  value={assignForm}
                  onChange={setAssignForm}
                  showLocation={t.kind !== 'installation'}
                  submitLabel="Confirm assignment"
                  submittingLabel="Assigning…"
                  submitting={assigning}
                  compact
                />
              </form>
            )}
          </div>
        ),
      });
    }

    for (const e of data.newEnquiries) {
      const urgency = enquiryUrgency(e.created_at, e.last_call_at);
      const age = e.last_call_at ? daysAgo(e.last_call_at) : daysAgo(e.created_at);
      const label = e.last_call_at ? `last called ${age}d ago` : urgency === 'red' ? `${age}d open` : `${age}d`;
      const tone: Tone = urgency === 'red' ? 'danger' : urgency === 'yellow' ? 'warn' : 'neutral';
      out.push({
        key: `enquiry-${e.id}`,
        group: 'enquiry',
        kind: 'enquiry',
        primary: toStartCase(e.customers.name),
        secondary: e.enquiry_product_interest ? toStartCase(e.enquiry_product_interest) : e.customers.phone_number,
        ageDays: age,
        ageLabel: label,
        ageTone: tone,
        priority: PRIORITY.enquiry,
        render: () => (
          <div key={e.id} className="py-3 border-b border-divider last:border-0 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold truncate flex items-center gap-1.5">
                <TypeTag kind="enquiry" />
                {toStartCase(e.customers.name)}
              </p>
              <p className="text-[13px] text-ink-2 truncate">{e.enquiry_product_interest ? toStartCase(e.enquiry_product_interest) : e.customers.phone_number}</p>
            </div>
            <span className={`text-[13px] font-medium shrink-0 ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink-2'}`}>
              {label}
            </span>
            <a href={`/admin/enquiries/${e.id}`} className="shrink-0 px-3 py-1.5 border border-rule text-[13px] font-semibold hover:bg-accent-tint">
              Open
            </a>
          </div>
        ),
      });
    }

    for (const t of data.dueForMarkDone) {
      const age = daysAgo(t.booked_date);
      out.push({
        key: `due-${t.id}`,
        group: 'closeout',
        kind: t.kind,
        primary: toStartCase(t.customers.name),
        secondary: t.customers.phone_number,
        ageDays: age,
        ageLabel: age >= 3 ? `${age}d overdue` : `${age}d`,
        ageTone: age >= 3 ? 'danger' : 'neutral',
        priority: t.kind === 'installation' ? PRIORITY.installation : PRIORITY.service_visit,
        render: () => (
          <div key={`due-${t.id}`} className="py-3 border-b border-divider last:border-0">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold truncate flex items-center gap-1.5">
                  <TypeTag kind={t.kind} />
                  {toStartCase(t.customers.name)}
                </p>
                <p className="text-[13px] text-ink-2 truncate">{t.customers.phone_number}</p>
              </div>
              <span className={`text-[13px] font-medium shrink-0 ${age >= 3 ? 'text-danger' : 'text-ink-2'}`}>
                {age >= 3 ? `${age}d overdue` : `${age}d`}
              </span>
              {t.kind === 'installation' ? (
                <button
                  onClick={() => (installConfirmId === t.id ? setInstallConfirmId(null) : startInstallConfirm(t.id))}
                  disabled={markingDoneId === t.id}
                  className="shrink-0 px-3 py-1.5 border border-rule text-[13px] font-semibold hover:bg-accent-tint disabled:opacity-50"
                >
                  {markingDoneId === t.id ? 'Saving…' : 'Installation completed'}
                </button>
              ) : (
                <a href={sellSparePartHref(t)} className="shrink-0 px-3 py-1.5 border border-rule text-[13px] font-semibold hover:bg-accent-tint">
                  Service completed
                </a>
              )}
            </div>
            {installConfirmId === t.id && (
              <div className="mt-3 pt-3 border-t border-divider space-y-2">
                <p className="text-[13px] text-ink-2">
                  {toStartCase(t.customers.name)} — {t.customers.phone_number}. Please call the customer to confirm
                  before marking this installation complete.
                </p>
                {markDoneError && <p className="text-danger text-[13px]">{markDoneError}</p>}
                <div className="flex items-center gap-2">
                  <label className="text-[13px] text-ink-2 shrink-0" htmlFor={`install-date-${t.id}`}>
                    Completion date
                  </label>
                  <input
                    id={`install-date-${t.id}`}
                    type="date"
                    max={todayIST()}
                    value={installConfirmDate}
                    onChange={(e) => setInstallConfirmDate(e.target.value)}
                    className="border border-rule rounded-xs px-2 py-1 text-[13px] focus-visible:outline-2 focus-visible:outline-accent"
                  />
                  <button
                    onClick={() => handleConfirmInstallDone(t.id)}
                    disabled={markingDoneId === t.id}
                    className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold disabled:opacity-50"
                  >
                    {markingDoneId === t.id ? 'Saving…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setInstallConfirmId(null)}
                    className="text-[13px] text-ink-2 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ),
      });
    }

    for (const s of data.serviceCallsDue) {
      const ageDays = Math.round(s.monthsSinceInstall * 30);
      out.push({
        key: `yearly-${s.installationTicketId}`,
        group: 'closeout',
        kind: 'service_visit',
        primary: toStartCase(s.customerName),
        secondary: [s.productLabel, s.area].filter(Boolean).map((x) => toStartCase(x as string)).join(' · '),
        ageDays,
        ageLabel: `${(s.monthsSinceInstall / 12).toFixed(1)}y since install`,
        ageTone: 'neutral',
        priority: PRIORITY.service_visit,
        render: () => (
          <div key={`yearly-${s.installationTicketId}`} className="py-3 border-b border-divider last:border-0 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold truncate flex items-center gap-1.5">
                <TypeTag kind="service_visit" />
                {toStartCase(s.customerName)}
              </p>
              <p className="text-[13px] text-ink-2 truncate">{[s.productLabel, s.area].filter(Boolean).map((x) => toStartCase(x as string)).join(' · ')}</p>
            </div>
            <span className="text-[13px] text-ink-2 shrink-0">{(s.monthsSinceInstall / 12).toFixed(1)}y since install</span>
            <a
              href={`/admin/service-calls?highlightInstallation=${s.installationTicketId}`}
              className="shrink-0 px-3 py-1.5 border border-rule text-[13px] font-semibold hover:bg-accent-tint"
            >
              View
            </a>
          </div>
        ),
      });
    }

    for (const o of data.paymentsOutstanding) {
      const age = o.oldestInstallationDate ? daysAgo(o.oldestInstallationDate) : 0;
      out.push({
        key: `payment-${o.phoneNumber}`,
        group: 'payment',
        kind: 'payment',
        primary: toStartCase(o.name),
        secondary: o.orderCount > 1 ? `${o.orderCount} purchases` : o.phoneNumber,
        ageDays: age,
        ageLabel: `${formatINR(o.totalBalance)}${o.oldestInstallationDate ? ` · ${age}d` : ''}`,
        ageTone: 'danger',
        priority: PRIORITY.payment,
        render: () => (
          <div key={`payment-${o.phoneNumber}`} className="py-3 border-b border-divider last:border-0 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold truncate flex items-center gap-1.5">
                <TypeTag kind="payment" />
                {toStartCase(o.name)}
              </p>
              <p className="text-[13px] text-ink-2 truncate">{o.orderCount > 1 ? `${o.orderCount} purchases` : o.phoneNumber}</p>
            </div>
            <span className="text-[13px] font-semibold text-danger tabular-nums shrink-0">
              {formatINR(o.totalBalance)}
              {o.oldestInstallationDate ? ` · ${age}d` : ''}
            </span>
            <a
              href={`/admin/customers?phone=${encodeURIComponent(o.phoneNumber)}`}
              className="shrink-0 px-3 py-1.5 border border-rule text-[13px] font-semibold hover:bg-accent-tint"
            >
              Record payment
            </a>
          </div>
        ),
      });
    }

    // "All" reads clearer grouped by kind (Dispatch, Installation, Service
    // visit, Follow up, Payment, Enquiry) than shuffled purely by age;
    // a single filtered view stays sorted oldest-first, since everything
    // in it is already the same kind.
    out.sort((a, b) => (filter === 'all' ? a.priority - b.priority || b.ageDays - a.ageDays : b.ageDays - a.ageDays));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    filter,
    assigningId,
    assignForm,
    assignError,
    assigning,
    staff,
    markingDoneId,
    markDoneError,
    installConfirmId,
    installConfirmDate,
  ]);

  const visibleRows = filter === 'all' ? rows : rows.filter((r) => r.group === filter);

  if (!data) return <p className="text-ink-2 text-[13px]">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* Attention strip — one bordered row of counters, each a filter
          shortcut into the queue below. A zero renders in plain ink. */}
      <div className="bg-surface border border-rule flex flex-wrap divide-x divide-rule">
        {[
          { label: 'Overdue dispatch', count: data.overdueDispatchCount, group: 'dispatch' as const },
          { label: 'Enquiries over 14 days', count: data.oldEnquiryCount, group: 'enquiry' as const },
          { label: 'Overdue to mark done', count: data.overdueMarkDoneCount, group: 'closeout' as const },
          { label: 'Payments overdue', count: data.overdueCallCount, group: 'payment' as const },
        ].map((s) => (
          <button
            key={s.label}
            onClick={() => setFilter(s.group)}
            className="flex-1 min-w-[160px] text-left px-4 py-3 hover:bg-accent-tint focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
          >
            <p className={`text-[24px] font-bold tabular-nums leading-none ${s.count > 0 ? 'text-danger' : 'text-ink'}`}>{s.count}</p>
            <p className="text-[13px] text-ink-2 mt-1">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Needs you today — the merged work queue. */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-[13px] font-semibold border ${
                filter === f.key ? 'bg-accent text-white border-accent' : 'border-rule text-ink-2 hover:bg-accent-tint'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <DashboardCard title="Needs you today" emptyText="Nothing needs attention right now.">
          {visibleRows.length > 0 && (
            <>
              {markDoneError && <p className="text-danger text-[13px] pt-3">{markDoneError}</p>}
              {visibleRows.map((r) => r.render())}
            </>
          )}
        </DashboardCard>
      </div>

      {editingJobId &&
        (() => {
          const job = data.weekJobs.find((j) => j.id === editingJobId);
          if (!job) return null;
          return (
            <form
              onSubmit={(e) => handleAssign(e, job)}
              className="bg-surface border border-rule p-4 space-y-2 max-w-md"
            >
              <div className="flex justify-between items-center">
                <p className="text-[13px] font-semibold">
                  Editing {toStartCase(job.customers.name)}&apos;s {job.kind === 'installation' ? 'installation' : 'service visit'}
                </p>
                <button type="button" onClick={() => setEditingJobId(null)} className="text-[13px] text-ink-2 hover:underline">
                  Cancel
                </button>
              </div>
              {assignError && <p className="text-danger text-[13px]">{assignError}</p>}
              <BookingForm
                staff={staff}
                value={assignForm}
                onChange={setAssignForm}
                showLocation={job.kind !== 'installation'}
                submitLabel="Save changes"
                submittingLabel="Saving…"
                submitting={assigning}
                compact
              />
            </form>
          );
        })()}

      <WeekSchedule
        days={data.scheduleDays}
        weekJobs={data.weekJobs}
        staff={staff}
        onJobClick={(j) => (editingJobId === j.id ? setEditingJobId(null) : startEditingJob(j))}
        activeJobId={editingJobId}
      />
    </div>
  );
}
