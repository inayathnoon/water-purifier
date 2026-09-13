'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { daysAgoIST, enquiryUrgency } from '@/lib/dates';
import BookingForm from '@/components/BookingForm';
import WeekSchedule from '@/components/dashboard/WeekSchedule';
import { useConfirm } from '@/components/useConfirm';
import { DashboardCard, Row, StaffMember, emptyAssignForm } from './shared';

const daysAgo = daysAgoIST;

interface CategoryTotal {
  count: number;
  revenue: number;
}

interface OwnerDashboardData {
  salesByCategory: { KITCHEN: CategoryTotal; VESSEL: CategoryTotal; COMMERCIAL: CategoryTotal; other: CategoryTotal; spare: CategoryTotal; serviceCharge: CategoryTotal };
  salesTotal: CategoryTotal;
  pendingLeaveCount: number;
  passedToOwner: { id: string; closure_explanation: string; customers: { name: string; phone_number: string } }[];
  paymentsOutstanding: {
    name: string;
    phoneNumber: string;
    totalBalance: number;
    oldestCreatedAt: string;
    lastPaymentCallAt: string | null;
    orderCount: number;
  }[];
  commercialVesselEnquiries: { id: string; created_at: string; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
  weekJobs: {
    id: string;
    kind: string;
    booked_date: string;
    booked_half_day: string;
    assigned_to_id: string | null;
    customers: { name: string };
  }[];
  jobsToDispatch: { id: string; kind: string; created_at: string; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
  weekStart: string;
  weekEnd: string;
}

// The "Finished Installation/Service" and "New enquiries" pieces are the
// exact same data admin's dashboard already computes and is already
// allowed to read (requireUser(['admin','owner','developer'])) — fetched
// straight from there rather than duplicating those queries a second
// time in /api/owner/dashboard.
interface OpsData {
  newEnquiries: { id: string; created_at: string; last_call_at: string | null; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
  oldEnquiryCount: number;
  dueForMarkDone: { id: string; kind: string; booked_date: string; spares_confirmed: boolean; customers: { name: string; phone_number: string } }[];
  overdueMarkDoneCount: number;
  awaitingConfirmation: { id: string; kind: string; actual_date: string; customers: { name: string; phone_number: string } }[];
  overdueConfirmationCount: number;
  satisfactionCallsDue: { orderId: string; installationDate: string; customers: { name: string; phone_number: string } }[];
}

const CATEGORY_CARDS: { key: 'KITCHEN' | 'VESSEL' | 'COMMERCIAL' | 'serviceCharge' | 'spare'; label: string; color: string }[] = [
  { key: 'KITCHEN', label: 'Kitchen', color: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
  { key: 'VESSEL', label: 'Vessel', color: 'bg-blue-50 border-blue-200 text-blue-900' },
  { key: 'COMMERCIAL', label: 'Commercial', color: 'bg-purple-50 border-purple-200 text-purple-900' },
  { key: 'serviceCharge', label: 'Service', color: 'bg-orange-50 border-orange-200 text-orange-900' },
  { key: 'spare', label: 'Spare parts', color: 'bg-teal-50 border-teal-200 text-teal-900' },
];

export default function OwnerDashboard() {
  const [data, setData] = useState<OwnerDashboardData | null>(null);
  const [ops, setOps] = useState<OpsData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState(emptyAssignForm());
  const [assignError, setAssignError] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [showAllConfirm, setShowAllConfirm] = useState(false);
  const [confirmingJobId, setConfirmingJobId] = useState<string | null>(null);
  const [confirmJobError, setConfirmJobError] = useState('');
  const [satisfactionNoteFor, setSatisfactionNoteFor] = useState<string | null>(null);
  const [satisfactionNote, setSatisfactionNote] = useState('');
  const [satisfactionError, setSatisfactionError] = useState('');
  const [confirmingSatisfaction, setConfirmingSatisfaction] = useState(false);
  const [markingDoneId, setMarkingDoneId] = useState<string | null>(null);
  const [markDoneError, setMarkDoneError] = useState('');
  const [confirm, confirmDialog] = useConfirm();

  const loadDashboard = () => {
    fetch('/api/owner/dashboard')
      .then((res) => res.json())
      .then(setData);
    fetch('/api/admin/dashboard')
      .then((res) => res.json())
      .then(setOps);
  };

  useEffect(() => {
    let cancelled = false;
    loadDashboard();
    fetch('/api/admin/staff')
      .then((res) => res.json())
      .then((d) => !cancelled && setStaff(d.staff ?? []));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAssigning = (id: string) => {
    setAssignError('');
    setAssigningId(id);
    setAssignForm(emptyAssignForm());
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
    loadDashboard();
  };

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

  const sellSparePartHref = (t: { id: string; kind: string; customers: { name: string; phone_number: string } }) =>
    `/admin/spare-parts?new=1&ticketId=${t.id}&kind=${t.kind}` +
    `&customerName=${encodeURIComponent(t.customers.name)}&phone=${encodeURIComponent(t.customers.phone_number)}`;

  const startSatisfaction = (orderId: string) => {
    setSatisfactionError('');
    setSatisfactionNoteFor(orderId);
    setSatisfactionNote('');
  };

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

  if (!data || !ops) return <p>Loading...</p>;

  return (
    <div>
      {confirmDialog}
      <div className="grid grid-cols-5 gap-2 max-w-2xl mb-4">
        {[
          { href: '/admin/enquiries', label: 'Enquiries' },
          { href: '/admin/orders', label: 'Purchases', newHref: '/admin/installations?new=1', newLabel: '+ New Purchase' },
          { href: '/admin/service-calls', label: 'Services' },
          { href: '/admin/customers', label: 'Customers' },
          { href: '/admin/products', label: 'Products' },
        ].map((item) => (
          <div key={item.href} className="flex flex-col gap-2">
            {item.newHref ? (
              <Link
                href={item.newHref}
                className="px-2 py-2 bg-green-600 text-white rounded-md text-sm text-center hover:bg-green-700"
              >
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

      {/* This month, at a glance — one card per segment, the total on the
          right, no plain white table. This is the owner's first read of
          the page, not a link list. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {CATEGORY_CARDS.map((c) => (
          <div key={c.key} className={`rounded-xl border p-3 ${c.color}`}>
            <p className="text-xs font-medium opacity-70">{c.label}</p>
            <p className="text-2xl font-bold tabular-nums mt-1">{data.salesByCategory[c.key].count}</p>
            <p className="text-sm font-medium tabular-nums opacity-80">₹{data.salesByCategory[c.key].revenue.toFixed(0)}</p>
          </div>
        ))}
        <div className="rounded-xl border border-gray-800 bg-gray-900 text-white p-3">
          <p className="text-xs font-medium opacity-70">Total</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{data.salesTotal.count}</p>
          <p className="text-sm font-medium tabular-nums opacity-90">₹{data.salesTotal.revenue.toFixed(0)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <DashboardCard
          title="Passed to you"
          emptyText="None waiting on you."
          viewAllHref="/admin/enquiries"
          shownCount={Math.min(5, data.passedToOwner.length)}
          totalCount={data.passedToOwner.length}
        >
          {data.passedToOwner.slice(0, 5).map((e) => (
            <Row key={e.id} href={`/admin/enquiries/${e.id}`} primary={e.customers.name} secondary={e.closure_explanation?.slice(0, 60) + '...'} />
          ))}
        </DashboardCard>

        <DashboardCard
          title="Vessel / Commercial enquiries"
          badge={data.commercialVesselEnquiries.length > 0 ? `${data.commercialVesselEnquiries.length}` : undefined}
          badgeColor="bg-purple-100 text-purple-800"
          emptyText="None open right now."
          viewAllHref="/admin/enquiries"
          shownCount={Math.min(5, data.commercialVesselEnquiries.length)}
          totalCount={data.commercialVesselEnquiries.length}
        >
          {data.commercialVesselEnquiries.slice(0, 5).map((e) => (
            <Row
              key={e.id}
              href={`/admin/enquiries/${e.id}`}
              primary={e.customers.name}
              secondary={e.customers.phone_number}
              tag={e.enquiry_product_interest}
            />
          ))}
        </DashboardCard>
      </div>

      {/* Day-to-day operations — same actions admin has (owner already
          has the same permissions server-side), arranged as asked:
          dispatch/finished-work on top, the week's schedule spanning
          below, enquiries/payments on the bottom row. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <DashboardCard
          title="Jobs to Dispatch"
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
                    <p className="text-xs text-gray-500">{t.enquiry_product_interest || t.customers.phone_number}</p>
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
            ops.overdueMarkDoneCount + ops.overdueConfirmationCount > 0
              ? `${ops.overdueMarkDoneCount + ops.overdueConfirmationCount} overdue`
              : undefined
          }
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing waiting here."
        >
          {(() => {
            const combined = [
              ...ops.dueForMarkDone.map((t) => ({ type: 'due' as const, t })),
              ...ops.awaitingConfirmation.map((t) => ({ type: 'job' as const, t })),
              ...ops.satisfactionCallsDue.map((s) => ({ type: 'satisfaction' as const, s })),
            ];
            const CONFIRM_LIMIT = 5;
            const visible = showAllConfirm ? combined : combined.slice(0, CONFIRM_LIMIT);
            return (
              <>
                {confirmJobError && <p className="text-red-600 text-xs mb-1">{confirmJobError}</p>}
                {markDoneError && <p className="text-red-600 text-xs mb-1">{markDoneError}</p>}
                {visible.map((item) =>
                  item.type === 'due' ? (
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
      </div>

      <div className="mb-3">
        <WeekSchedule weekStart={data.weekStart} weekEnd={data.weekEnd} weekJobs={data.weekJobs} staff={staff} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <DashboardCard
          title="New enquiries"
          badge={ops.oldEnquiryCount > 0 ? `${ops.oldEnquiryCount} over 14 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing open."
          viewAllHref="/admin/enquiries"
          shownCount={Math.min(5, ops.newEnquiries.length)}
          totalCount={ops.newEnquiries.length}
        >
          {ops.newEnquiries.slice(0, 5).map((e) => {
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
          title="Payments outstanding"
          badge={data.paymentsOutstanding.filter((o) => daysAgo(o.oldestCreatedAt) >= 7).length > 0 ? `${data.paymentsOutstanding.filter((o) => daysAgo(o.oldestCreatedAt) >= 7).length} over 7 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing owed. Nice."
          viewAllHref="/admin/orders"
          shownCount={Math.min(5, data.paymentsOutstanding.length)}
          totalCount={data.paymentsOutstanding.length}
          highlight={data.paymentsOutstanding.length > 0}
        >
          {data.paymentsOutstanding.slice(0, 5).map((o) => {
            const overdue = daysAgo(o.oldestCreatedAt) >= 7;
            return (
              <Row
                key={o.phoneNumber}
                href={`/admin/customers?phone=${encodeURIComponent(o.phoneNumber)}`}
                primary={o.name}
                secondary={
                  (o.orderCount > 1 ? `${o.orderCount} purchases · ` : '') +
                  (o.lastPaymentCallAt ? `last called ${daysAgo(o.lastPaymentCallAt)}d ago` : 'never called')
                }
                tag={`₹${o.totalBalance}${overdue ? ` · ${daysAgo(o.oldestCreatedAt)}d` : ''}`}
                tagColor="text-red-600"
              />
            );
          })}
        </DashboardCard>
      </div>

      {data.pendingLeaveCount > 0 && (
        <Link
          href="/owner/leave"
          className="block mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 hover:bg-yellow-100"
        >
          {data.pendingLeaveCount} leave request(s) waiting on you →
        </Link>
      )}
    </div>
  );
}
