'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { daysAgoIST, enquiryUrgency } from '@/lib/dates';
import BookingForm from '@/components/BookingForm';
import WeekSchedule from '@/components/dashboard/WeekSchedule';
import { useConfirm } from '@/components/useConfirm';
import { DashboardCard, Row, StaffMember, emptyAssignForm } from './shared';

const daysAgo = daysAgoIST;

interface AdminDashboardData {
  newEnquiries: { id: string; created_at: string; last_call_at: string | null; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
  oldEnquiryCount: number;
  jobsToDispatch: { id: string; kind: string; created_at: string; enquiry_product_interest: string; customers: { name: string; phone_number: string; area: string } }[];
  overdueDispatchCount: number;
  dueForMarkDone: { id: string; kind: string; booked_date: string; spares_confirmed: boolean; customers: { name: string; phone_number: string } }[];
  overdueMarkDoneCount: number;
  awaitingConfirmation: { id: string; kind: string; actual_date: string; customers: { name: string; phone_number: string } }[];
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
  overdueConfirmationCount: number;
  satisfactionCallsDue: { orderId: string; installationDate: string; customers: { name: string; phone_number: string } }[];
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
  weekStart: string;
  weekEnd: string;
}

export default function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState(emptyAssignForm());
  const [assignError, setAssignError] = useState('');
  const [assigning, setAssigning] = useState(false);
  // "Finished Installation/Service" card — confirming right from the
  // dashboard instead of navigating to Purchases/Services first.
  const [showAllConfirm, setShowAllConfirm] = useState(false);
  const [confirmingJobId, setConfirmingJobId] = useState<string | null>(null);
  const [confirmJobError, setConfirmJobError] = useState('');
  const [satisfactionNoteFor, setSatisfactionNoteFor] = useState<string | null>(null);
  const [satisfactionNote, setSatisfactionNote] = useState('');
  const [satisfactionError, setSatisfactionError] = useState('');
  const [confirmingSatisfaction, setConfirmingSatisfaction] = useState(false);
  // Part 1 of "Finished Installation/Service" — no technician login to
  // mark their own job done any more, so admin does it from here.
  const [markingDoneId, setMarkingDoneId] = useState<string | null>(null);
  const [markDoneError, setMarkDoneError] = useState('');
  const [confirm, confirmDialog] = useConfirm();

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

  // §5: reassign/reschedule a job that's already booked, straight from
  // the This Week grid — same book endpoint as a fresh assignment (it's
  // just an update either way), pre-filled with what's there now instead
  // of starting blank.
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
    // Installations always happen at the customer's home, regardless of
    // whatever the (hidden, for installations) location select last held.
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

  // The tech has already marked the job done — this is the admin's
  // confirmation call, right from the dashboard instead of navigating to
  // Purchases/Services first. Same endpoint both those pages already use.
  const handleConfirmJob = async (ticketId: string) => {
    setConfirmJobError('');
    setConfirmingJobId(ticketId);
    const res = await fetch(`/api/admin/tickets/${ticketId}/close`, { method: 'POST' });
    setConfirmingJobId(null);
    if (!res.ok) {
      setConfirmJobError((await res.json()).error ?? 'Failed to confirm');
      return;
    }
    loadDashboard();
  };

  // Part 1 — "Installed" / "Service completed": the tech has reported
  // back (phone/Telegram) that the job is done; admin records it here.
  // Stamps today as the completion date — see CLAUDE.md's staff-portal
  // removal note for why there's no backdating field.
  const handleMarkDone = async (ticketId: string, label: string) => {
    if (!(await confirm(`Mark this ${label.toLowerCase()} done?`))) return;
    setMarkDoneError('');
    setMarkingDoneId(ticketId);
    const res = await fetch(`/api/admin/tickets/${ticketId}/mark-done`, { method: 'POST' });
    setMarkingDoneId(null);
    if (!res.ok) {
      setMarkDoneError((await res.json()).error ?? 'Failed to mark done');
      return;
    }
    loadDashboard();
  };

  // Part 2 — any spare part sold gets recorded on Sell Spare Part,
  // pre-filled and tagged with this job's own ticket id so the sale is
  // traceable back to it (§13.3's warranty-free check is enforced there,
  // server-side, from the ticket this links to).
  const sellSparePartHref = (t: { id: string; kind: string; customers: { name: string; phone_number: string } }) =>
    `/admin/spare-parts?new=1&ticketId=${t.id}&kind=${t.kind}` +
    `&customerName=${encodeURIComponent(t.customers.name)}&phone=${encodeURIComponent(t.customers.phone_number)}`;

  const startSatisfaction = (orderId: string) => {
    setSatisfactionError('');
    setSatisfactionNoteFor(orderId);
    setSatisfactionNote('');
  };

  // A separate follow-up satisfaction call, needing its own short note
  // (mirrors §5.4/§5.5's word-count rule) — same endpoint /admin/orders
  // already uses for "Log follow-up call".
  const handleConfirmSatisfaction = async (e: React.FormEvent, orderId: string) => {
    e.preventDefault();
    if (confirmingSatisfaction) return;
    setSatisfactionError('');
    setConfirmingSatisfaction(true);
    const res = await fetch(`/api/admin/orders/${orderId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: satisfactionNote }),
    });
    setConfirmingSatisfaction(false);
    if (!res.ok) {
      setSatisfactionError((await res.json()).error ?? 'Failed to confirm');
      return;
    }
    setSatisfactionNoteFor(null);
    setSatisfactionNote('');
    loadDashboard();
  };

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      {confirmDialog}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">Today — everyone you need to call</h2>
          <Link href="/admin/leave" className="text-sm text-blue-600 hover:underline">
            Request time off →
          </Link>
        </div>
        <div className="grid grid-cols-6 gap-2 max-w-3xl">
          {[
            { href: '/admin/enquiries', label: 'Enquiries', newHref: '/admin/enquiries?new=1', newLabel: '+ New Enquiry', newColor: 'bg-blue-600 hover:bg-blue-700 text-white' },
            { href: '/admin/orders', label: 'Purchases', newHref: '/admin/installations?new=1', newLabel: '+ New Purchase', newColor: 'bg-green-600 hover:bg-green-700 text-white' },
            { href: '/admin/service-calls', label: 'Services', newHref: '/admin/service-calls?new=1', newLabel: '+ New Service', newColor: 'bg-yellow-500 hover:bg-yellow-600 text-gray-900' },
            { href: '/admin/spare-parts', label: 'Spares', newHref: '/admin/spare-parts?new=1', newLabel: '+ Sell Spares', newColor: 'bg-orange-500 hover:bg-orange-600 text-white' },
            { href: '/admin/customers', label: 'Customers' },
            { href: '/admin/products', label: 'Products' },
          ].map((item) => (
            <div key={item.href} className="flex flex-col gap-2">
              {item.newHref ? (
                <Link href={item.newHref} className={`px-2 py-2 rounded-md text-sm text-center ${item.newColor}`}>
                  {item.newLabel}
                </Link>
              ) : (
                <div className="px-2 py-2 text-sm invisible">—</div>
              )}
              <Link
                href={item.href}
                className="px-2 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 text-center hover:bg-gray-50 hover:border-gray-400"
              >
                {item.label}
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DashboardCard
          title="New enquiries"
          badge={data.oldEnquiryCount > 0 ? `${data.oldEnquiryCount} over 14 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing open."
          viewAllHref="/admin/enquiries"
          shownCount={Math.min(5, data.newEnquiries.length)}
          totalCount={data.newEnquiries.length}
        >
          {data.newEnquiries.slice(0, 5).map((e) => {
            // Still sorted oldest-created-first (unchanged) even once
            // flagged again — only the label/color reflect the call.
            const urgency = enquiryUrgency(e.created_at, e.last_call_at);
            const tag = e.last_call_at
              ? `Last called ${daysAgo(e.last_call_at)}d ago`
              : urgency === 'red'
                ? `${daysAgo(e.created_at)}d — decide now`
                : `${daysAgo(e.created_at)}d`;
            const tagColor = urgency === 'red' ? 'text-red-600' : urgency === 'yellow' ? 'text-yellow-700' : 'text-gray-900';
            return (
              <Row
                key={e.id}
                href={`/admin/enquiries/${e.id}`}
                primary={e.customers.name}
                secondary={e.enquiry_product_interest || e.customers.phone_number}
                tag={tag}
                tagColor={tagColor}
              />
            );
          })}
        </DashboardCard>

        <DashboardCard
          title="Jobs to dispatch"
          badge={data.overdueDispatchCount > 0 ? `${data.overdueDispatchCount} over 3 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing waiting on a technician."
          viewAllLinks={[
            { label: 'New Installation', href: '/admin/installations' },
            { label: 'Services', href: '/admin/service-calls' },
          ]}
          shownCount={Math.min(5, data.jobsToDispatch.length)}
          totalCount={data.jobsToDispatch.length}
        >
          {data.jobsToDispatch.slice(0, 5).map((t) => {
            const age = daysAgo(t.created_at);
            return (
              <div key={t.id} className="py-2 border-b last:border-0">
                <div className="flex justify-between items-center gap-2">
                  <div>
                    <p className="text-sm font-medium">{t.customers.name}</p>
                    <p className="text-xs text-gray-500">
                      {t.enquiry_product_interest || t.customers.phone_number}
                      {t.customers.area ? ` · ${t.customers.area}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs ${age >= 3 ? 'text-red-600' : 'text-gray-900'}`}>
                      {t.kind === 'installation' ? 'Installation' : 'Service visit'} · {age}d
                      {age >= 3 ? ' — overdue' : ''}
                    </span>
                    <button
                      onClick={() => (assigningId === t.id ? setAssigningId(null) : startAssigning(t.id))}
                      className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 whitespace-nowrap"
                    >
                      Assign
                    </button>
                  </div>
                </div>

                {assigningId === t.id && (
                  <form onSubmit={(e) => handleAssign(e, t)} className="mt-2 pt-2 border-t space-y-2">
                    {assignError && <p className="text-red-600 text-xs">{assignError}</p>}
                    {/* Installations always happen at the customer's home
                        — only a service visit can be brought to the office. */}
                    <BookingForm
                      staff={staff}
                      value={assignForm}
                      onChange={setAssignForm}
                      showLocation={t.kind !== 'installation'}
                      submitLabel="Confirm assignment"
                      submittingLabel="Assigning..."
                      submitting={assigning}
                      compact
                    />
                  </form>
                )}
              </div>
            );
          })}
        </DashboardCard>

        <DashboardCard
          title="Finished Installation/Service"
          badge={
            data.overdueMarkDoneCount + data.overdueConfirmationCount > 0
              ? `${data.overdueMarkDoneCount + data.overdueConfirmationCount} overdue`
              : undefined
          }
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing waiting here."
        >
          {(() => {
            const combined = [
              ...data.dueForMarkDone.map((t) => ({ type: 'due' as const, t })),
              ...data.awaitingConfirmation.map((t) => ({ type: 'job' as const, t })),
              ...data.satisfactionCallsDue.map((s) => ({ type: 'satisfaction' as const, s })),
            ];
            const CONFIRM_LIMIT = 5;
            const visible = showAllConfirm ? combined : combined.slice(0, CONFIRM_LIMIT);
            return (
              <>
                {confirmJobError && <p className="text-red-600 text-xs mb-1">{confirmJobError}</p>}
                {markDoneError && <p className="text-red-600 text-xs mb-1">{markDoneError}</p>}
                {visible.map((item) =>
                  item.type === 'due' ? (
                    // Part 1 (Installed/Service completed) + part 2 (any spare sold).
                    <div key={`due-${item.t.id}`} className="py-2 border-b last:border-0 flex justify-between items-center gap-2">
                      <div>
                        <p className="text-sm font-medium">{item.t.customers.name}</p>
                        <p className="text-xs text-gray-500">{item.t.customers.phone_number}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs ${daysAgo(item.t.booked_date) >= 3 ? 'text-red-600' : 'text-gray-900'}`}>
                          {item.t.kind === 'installation' ? 'Installation' : 'Service visit'} · {daysAgo(item.t.booked_date)}d
                          {daysAgo(item.t.booked_date) >= 3 ? ' — overdue' : ''}
                        </span>
                        <Link href={sellSparePartHref(item.t)} className="px-2 py-1 border rounded text-xs hover:bg-gray-50 whitespace-nowrap">
                          + Spare part
                        </Link>
                        <button
                          onClick={() => handleMarkDone(item.t.id, item.t.kind === 'installation' ? 'Installation' : 'Service visit')}
                          disabled={markingDoneId === item.t.id || (item.t.kind === 'service_visit' && !item.t.spares_confirmed)}
                          title={
                            item.t.kind === 'service_visit' && !item.t.spares_confirmed
                              ? 'Record spare parts (or "No parts used") first'
                              : undefined
                          }
                          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {markingDoneId === item.t.id ? 'Saving...' : item.t.kind === 'installation' ? 'Installed' : 'Service completed'}
                        </button>
                      </div>
                    </div>
                  ) : item.type === 'job' ? (
                    // Part 2 (any spare sold, if not already) + part 3 (calling customer to confirm).
                    <div key={`job-${item.t.id}`} className="py-2 border-b last:border-0 flex justify-between items-center gap-2">
                      <div>
                        <p className="text-sm font-medium">{item.t.customers.name}</p>
                        <p className="text-xs text-gray-500">{item.t.customers.phone_number}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs ${daysAgo(item.t.actual_date) >= 7 ? 'text-red-600' : 'text-gray-900'}`}>
                          {item.t.kind === 'installation' ? 'Installation' : 'Service visit'} · {daysAgo(item.t.actual_date)}d
                          {daysAgo(item.t.actual_date) >= 7 ? ' — overdue' : ''}
                        </span>
                        <Link href={sellSparePartHref(item.t)} className="px-2 py-1 border rounded text-xs hover:bg-gray-50 whitespace-nowrap">
                          + Spare part
                        </Link>
                        {(() => {
                          const submitting = confirmingJobId === item.t.id;
                          // A service visit's confirm step reads as "called
                          // to confirm" (yellow, waiting) rather than a plain
                          // blue "Confirm" — an installation's stays as-is.
                          const isServiceVisit = item.t.kind === 'service_visit';
                          const color = isServiceVisit
                            ? submitting
                              ? 'bg-green-600 hover:bg-green-700 text-white'
                              : 'bg-yellow-500 hover:bg-yellow-600 text-gray-900'
                            : 'bg-blue-600 hover:bg-blue-700 text-white';
                          const label = isServiceVisit ? (submitting ? 'Complete' : 'Called to confirm') : submitting ? 'Confirming...' : 'Confirm';
                          return (
                            <button
                              onClick={() => handleConfirmJob(item.t.id)}
                              disabled={submitting}
                              className={`px-2 py-1 rounded text-xs disabled:opacity-50 whitespace-nowrap ${color}`}
                            >
                              {label}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div key={`satisfaction-${item.s.orderId}`} className="py-2 border-b last:border-0">
                      <div className="flex justify-between items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">{item.s.customers.name}</p>
                          <p className="text-xs text-gray-500">{item.s.customers.phone_number}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-900">
                            Follow-up · installed {daysAgo(item.s.installationDate)}d ago
                          </span>
                          <button
                            onClick={() => (satisfactionNoteFor === item.s.orderId ? setSatisfactionNoteFor(null) : startSatisfaction(item.s.orderId))}
                            className="px-2 py-1 border rounded text-xs hover:bg-gray-50 whitespace-nowrap"
                          >
                            {satisfactionNoteFor === item.s.orderId ? 'Cancel' : 'Confirm'}
                          </button>
                        </div>
                      </div>
                      {satisfactionNoteFor === item.s.orderId && (
                        <form onSubmit={(e) => handleConfirmSatisfaction(e, item.s.orderId)} className="mt-2 pt-2 border-t flex gap-2">
                          {satisfactionError && <p className="w-full text-red-600 text-xs">{satisfactionError}</p>}
                          <input
                            required
                            placeholder="What did they say? (3+ words)"
                            className="border rounded px-2 py-1.5 text-xs flex-1"
                            value={satisfactionNote}
                            onChange={(e) => setSatisfactionNote(e.target.value)}
                          />
                          <button
                            type="submit"
                            disabled={confirmingSatisfaction}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs hover:bg-blue-700 disabled:opacity-50"
                          >
                            {confirmingSatisfaction ? 'Saving...' : 'Save'}
                          </button>
                        </form>
                      )}
                    </div>
                  )
                )}
                {combined.length > CONFIRM_LIMIT && (
                  <button onClick={() => setShowAllConfirm((s) => !s)} className="block text-sm text-blue-600 hover:underline mt-2">
                    {showAllConfirm ? 'Show less ▲' : `View all (${combined.length}) →`}
                  </button>
                )}
              </>
            );
          })()}
        </DashboardCard>

        <DashboardCard
          title="Payments outstanding"
          badge={data.overdueCallCount > 0 ? `${data.overdueCallCount} overdue for a call` : undefined}
          badgeColor="bg-orange-100 text-orange-800"
          emptyText="Nothing owed. Nice."
          viewAllHref="/admin/orders"
          shownCount={Math.min(5, data.paymentsOutstanding.length)}
          totalCount={data.paymentsOutstanding.length}
        >
          {data.paymentsOutstanding.slice(0, 5).map((o) => (
            <Row
              key={o.phoneNumber}
              href={`/admin/customers?phone=${encodeURIComponent(o.phoneNumber)}`}
              primary={o.name}
              secondary={o.orderCount > 1 ? `${o.orderCount} purchases` : o.phoneNumber}
              tag={`₹${o.totalBalance} owed${o.oldestInstallationDate ? ` · ${daysAgo(o.oldestInstallationDate)}d` : ''}`}
              tagColor="text-red-600"
            />
          ))}
        </DashboardCard>

        <DashboardCard
          title="Yearly service calls due"
          badge={data.serviceCallsDue.length > 0 ? `${data.serviceCallsDue.length} this month` : undefined}
          badgeColor="bg-blue-100 text-blue-800"
          emptyText="None due this month."
          viewAllHref="/admin/service-calls"
          shownCount={Math.min(5, data.serviceCallsDue.length)}
          totalCount={data.serviceCallsDue.length}
        >
          {data.serviceCallsDue.slice(0, 5).map((s) => (
            <Row
              key={s.installationTicketId}
              href={`/admin/service-calls?highlightInstallation=${s.installationTicketId}`}
              primary={s.customerName}
              secondary={`${s.phoneNumber} · ${s.area}`}
              tag={`${(s.monthsSinceInstall / 12).toFixed(1)}y since install`}
            />
          ))}
        </DashboardCard>
      </div>

      <div className="mt-6">
        <WeekSchedule
          weekStart={data.weekStart}
          weekEnd={data.weekEnd}
          weekJobs={data.weekJobs}
          staff={staff}
          onJobClick={(j) => (editingJobId === j.id ? setEditingJobId(null) : startEditingJob(j))}
          activeJobId={editingJobId}
        />

        {editingJobId &&
          (() => {
            const job = data.weekJobs.find((j) => j.id === editingJobId);
            if (!job) return null;
            return (
              <form
                onSubmit={(e) => handleAssign(e, job)}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 space-y-2 max-w-md"
              >
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium">
                    Editing {job.customers.name}'s {job.kind === 'installation' ? 'installation' : 'service visit'}
                  </p>
                  <button type="button" onClick={() => setEditingJobId(null)} className="text-xs text-gray-600 hover:underline">
                    Cancel
                  </button>
                </div>
                {assignError && <p className="text-red-600 text-xs">{assignError}</p>}
                <BookingForm
                  staff={staff}
                  value={assignForm}
                  onChange={setAssignForm}
                  showLocation={job.kind !== 'installation'}
                  submitLabel="Save changes"
                  submittingLabel="Saving..."
                  submitting={assigning}
                  compact
                />
              </form>
            );
          })()}
      </div>
    </div>
  );
}
