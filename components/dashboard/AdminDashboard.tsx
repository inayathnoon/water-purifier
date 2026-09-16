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

type QueueGroup = 'dispatch' | 'enquiry' | 'closeout' | 'payment';

// One unified row shape the dashboard's four boxes are built from — every
// source list (dispatch, enquiries, close-outs, yearly service, payments)
// reduces to this so they can share one sort and one render, split into
// its four boxes purely by `group`.
interface QueueRow {
  key: string;
  group: QueueGroup;
  kind: string;
  primary: string;
  secondary: string;
  ageDays: number;
  ageLabel: string;
  ageTone: Tone;
  render: () => React.ReactNode;
}

export default function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
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
    // Marks done and closes in the same request now (see mark-done's own
    // route for why) — one call, not two, so there's no gap a network
    // blip could strand this job in.
    const res = await fetch(`/api/admin/tickets/${ticketId}/mark-done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actualDate: installConfirmDate }),
    });
    setMarkingDoneId(null);
    if (!res.ok) {
      setMarkDoneError((await res.json()).error ?? 'Failed to mark done');
      return;
    }
    setInstallConfirmId(null);
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

    out.sort((a, b) => b.ageDays - a.ageDays);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
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

  if (!data) return <p className="text-ink-2 text-[13px]">Loading…</p>;

  const dispatchRows = rows.filter((r) => r.group === 'dispatch');
  const enquiryRows = rows.filter((r) => r.group === 'enquiry');
  const closeoutRows = rows.filter((r) => r.group === 'closeout');
  const paymentRows = rows.filter((r) => r.group === 'payment');

  return (
    // Plain page flow, no viewport-height math — a card's content is as
    // tall as its own rows, capped at ~5 before it scrolls inside itself.
    // The card itself, though, stretches to match its row partner (default
    // grid stretch, no items-start) so a quiet-day card doesn't leave an
    // empty gray gap next to a busier neighbour — the shorter card's own
    // background/border just extends down to meet it.
    <div className="flex flex-col gap-4">
      {markDoneError && <p className="text-danger text-[13px]">{markDoneError}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DashboardCard
          // An open Assign form would otherwise have to be filled in
          // through a 5-row scroll window — let this one card grow while
          // it's open.
          capRows={!assigningId}
          title="Jobs to dispatch"
          badge={data.overdueDispatchCount > 0 ? `${data.overdueDispatchCount} overdue` : undefined}
          tone="danger"
          emptyText="Nothing waiting on a technician."
        >
          {dispatchRows.map((r) => r.render())}
        </DashboardCard>
        <DashboardCard
          capRows={!installConfirmId}
          title="Close-outs"
          badge={data.overdueMarkDoneCount > 0 ? `${data.overdueMarkDoneCount} overdue` : undefined}
          tone="danger"
          emptyText="Nothing needs closing out."
        >
          {closeoutRows.map((r) => r.render())}
        </DashboardCard>
        <DashboardCard
          capRows
          title="New enquiries"
          badge={data.oldEnquiryCount > 0 ? `${data.oldEnquiryCount} over 14 days` : undefined}
          tone="danger"
          emptyText="Nothing open."
        >
          {enquiryRows.map((r) => r.render())}
        </DashboardCard>
        <DashboardCard
          capRows
          title="Payments outstanding"
          badge={data.overdueCallCount > 0 ? `${data.overdueCallCount} overdue` : undefined}
          tone="warn"
          emptyText="Nothing owed."
        >
          {paymentRows.map((r) => r.render())}
        </DashboardCard>
      </div>

      <div>
        <WeekSchedule
          days={data.scheduleDays}
          weekJobs={data.weekJobs}
          staff={staff}
          onJobClick={(j) => (editingJobId === j.id ? setEditingJobId(null) : startEditingJob(j))}
          activeJobId={editingJobId}
        />
      </div>

      {/* A fixed overlay, not inline flow — editing a job from the
          schedule shouldn't reshuffle the fixed-height layout above. */}
      {editingJobId &&
        (() => {
          const job = data.weekJobs.find((j) => j.id === editingJobId);
          if (!job) return null;
          return (
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/40 p-4" onClick={() => setEditingJobId(null)}>
              <form
                onSubmit={(e) => handleAssign(e, job)}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface border border-rule p-4 space-y-2 max-w-md w-full shadow-lg"
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
            </div>
          );
        })()}
    </div>
  );
}
