'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { daysAgoIST } from '@/lib/dates';
import BookingForm from '@/components/BookingForm';
import WeekSchedule from '@/components/dashboard/WeekSchedule';
import { DashboardCard, Row, StatCard, StaffMember, emptyAssignForm } from './shared';

const daysAgo = daysAgoIST;

interface OwnerDashboardData {
  todaysJobs: { id: string; kind: string; customers: { name: string } }[];
  whoIsBusy: Record<string, number>;
  monthRevenue: { sold: number; discount: number; collected: number };
  salesByCategory: { KITCHEN: number; VESSEL: number; COMMERCIAL: number; other: number; spare: number; serviceCharge: number };
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

export default function OwnerDashboard() {
  const [data, setData] = useState<OwnerDashboardData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState(emptyAssignForm);
  const [assignError, setAssignError] = useState('');
  const [assigning, setAssigning] = useState(false);

  const loadDashboard = () => {
    fetch('/api/owner/dashboard')
      .then((res) => res.json())
      .then(setData);
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
    setAssignForm(emptyAssignForm);
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

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Business overview</h2>
        <div className="grid grid-cols-5 gap-2 max-w-2xl">
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard label="Jobs today" value={String(data.todaysJobs.length)} />
        <StatCard label="Sold this month" value={`₹${data.monthRevenue.sold.toFixed(2)}`} />
        <StatCard label="Collected this month" value={`₹${data.monthRevenue.collected.toFixed(2)}`} />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
        <h2 className="font-semibold mb-3">Sales by category — this month</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {[
                ['Vessel', data.salesByCategory.VESSEL],
                ['Kitchen', data.salesByCategory.KITCHEN],
                ['Commercial', data.salesByCategory.COMMERCIAL],
                ['Spare parts', data.salesByCategory.spare],
                ['Service charge', data.salesByCategory.serviceCharge],
                ...(data.salesByCategory.other > 0 ? [['Other (no product on record)', data.salesByCategory.other]] as [string, number][] : []),
              ].map(([label, amount]) => (
                <tr key={label}>
                  <td className="py-2 text-gray-900">{label}</td>
                  <td className="py-2 text-right font-medium">₹{Number(amount).toFixed(2)}</td>
                </tr>
              ))}
              <tr className="border-t-2">
                <td className="py-2 font-semibold">Total</td>
                <td className="py-2 text-right font-semibold">
                  ₹
                  {(
                    data.salesByCategory.VESSEL +
                    data.salesByCategory.KITCHEN +
                    data.salesByCategory.COMMERCIAL +
                    data.salesByCategory.spare +
                    data.salesByCategory.serviceCharge +
                    data.salesByCategory.other
                  ).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Spare parts includes both an office walk-in sale and whatever a tech sold during a visit.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DashboardCard title="Who's busy today" emptyText="No jobs booked today.">
          {Object.entries(data.whoIsBusy).map(([name, count]) => (
            <div key={name} className="flex justify-between py-2 border-b last:border-0 text-sm">
              <span>{name}</span>
              <span className="text-gray-900">{count} job(s)</span>
            </div>
          ))}
        </DashboardCard>

        <DashboardCard title="Discount given this month" emptyText="">
          <p className="text-2xl font-semibold text-gray-900">₹{data.monthRevenue.discount.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">Margin sits between list price and sold price (§7.6)</p>
        </DashboardCard>

        <DashboardCard
          title="Enquiries passed to you"
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
          title="Commercial / Vessel enquiries"
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

        <DashboardCard
          title="Payments Pending"
          badge={data.paymentsOutstanding.filter((o) => daysAgo(o.oldestCreatedAt) >= 7).length > 0 ? `${data.paymentsOutstanding.filter((o) => daysAgo(o.oldestCreatedAt) >= 7).length} over 7 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing owed. Nice."
          viewAllHref="/admin/orders"
          shownCount={Math.min(5, data.paymentsOutstanding.length)}
          totalCount={data.paymentsOutstanding.length}
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
                tagColor={overdue ? 'text-red-600' : undefined}
              />
            );
          })}
        </DashboardCard>
      </div>

      <div className="mt-6">
        <WeekSchedule weekStart={data.weekStart} weekEnd={data.weekEnd} weekJobs={data.weekJobs} staff={staff} />

        <DashboardCard
          title="Jobs to Dispatch"
          emptyText="Nothing waiting on a technician."
          viewAllLinks={[
            { label: 'Installations', href: '/admin/installations' },
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
      </div>

      {data.pendingLeaveCount > 0 && (
        <Link
          href="/owner/leave"
          className="block mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 hover:bg-yellow-100"
        >
          {data.pendingLeaveCount} leave request(s) waiting on you →
        </Link>
      )}
    </div>
  );
}
