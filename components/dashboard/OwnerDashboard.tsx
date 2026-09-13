'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { daysAgoIST } from '@/lib/dates';
import WeekSchedule from '@/components/dashboard/WeekSchedule';
import { DashboardCard, Row, StaffMember } from './shared';

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
  scheduleDays: string[];
}

// One accent voice (blue), neutral surfaces for everything else — a card
// per segment doesn't need five different hues to read as five segments;
// the label already says which is which.
const CATEGORY_CARDS: { key: 'KITCHEN' | 'VESSEL' | 'COMMERCIAL' | 'serviceCharge' | 'spare'; label: string }[] = [
  { key: 'KITCHEN', label: 'Kitchen' },
  { key: 'VESSEL', label: 'Vessel' },
  { key: 'COMMERCIAL', label: 'Commercial' },
  { key: 'serviceCharge', label: 'Service' },
  { key: 'spare', label: 'Spare parts' },
];

export default function OwnerDashboard() {
  const [data, setData] = useState<OwnerDashboardData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/owner/dashboard')
      .then((res) => res.json())
      .then((d) => !cancelled && setData(d));
    fetch('/api/admin/staff')
      .then((res) => res.json())
      .then((d) => !cancelled && setStaff(d.staff ?? []));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <div className="grid grid-cols-5 gap-2 max-w-2xl mb-4">
        {[
          { href: '/admin/enquiries', label: 'Enquiries' },
          { href: '/admin/orders', label: 'Purchases' },
          { href: '/admin/service-calls', label: 'Services' },
          { href: '/admin/customers', label: 'Customers' },
          { href: '/admin/products', label: 'Products' },
        ].map((item) => (
          <div key={item.href} className="flex flex-col gap-2">
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {CATEGORY_CARDS.map((c) => (
          <div key={c.key} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs font-medium text-gray-500">{c.label}</p>
            <p className="text-2xl font-bold tabular-nums mt-1 text-gray-900">{data.salesByCategory[c.key].count}</p>
            <p className="text-sm font-medium tabular-nums text-blue-700">₹{data.salesByCategory[c.key].revenue.toFixed(0)}</p>
          </div>
        ))}
        <div className="rounded-xl border border-gray-900 bg-gray-900 text-white p-3">
          <p className="text-xs font-medium text-gray-400">Total</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{data.salesTotal.count}</p>
          <p className="text-sm font-medium tabular-nums text-blue-300">₹{data.salesTotal.revenue.toFixed(0)}</p>
        </div>
      </div>

      {/* Escalations first, dispatch status third — status cards are
          view-only (admin does the assigning/marking-done/confirming day
          to day), the owner just sees where things stand. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <DashboardCard
          title="Vessel / Commercial enquiries"
          badge={data.commercialVesselEnquiries.length > 0 ? `${data.commercialVesselEnquiries.length}` : undefined}
          badgeColor="bg-gray-100 text-gray-700"
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
              <Row
                key={t.id}
                href={t.kind === 'installation' ? '/admin/installations' : '/admin/service-calls'}
                primary={t.customers.name}
                secondary={t.enquiry_product_interest || t.customers.phone_number}
                tag={`${t.kind === 'installation' ? 'Installation' : 'Service visit'} · ${age}d${age >= 3 ? ' — overdue' : ''}`}
                tagColor={age >= 3 ? 'text-red-600' : undefined}
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

      <div className="mb-4">
        <WeekSchedule days={data.scheduleDays} weekJobs={data.weekJobs} staff={staff} />
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
