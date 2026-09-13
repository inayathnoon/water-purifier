'use client';

import { useEffect, useState } from 'react';
import { daysAgoIST } from '@/lib/dates';
import { toStartCase, formatINR } from '@/lib/format';
import WeekSchedule from '@/components/dashboard/WeekSchedule';
import { DashboardCard, Row, StaffMember, StatCell } from './shared';

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

const CATEGORY_CELLS: { key: 'KITCHEN' | 'VESSEL' | 'COMMERCIAL' | 'serviceCharge' | 'spare'; label: string }[] = [
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

  if (!data) return <p className="text-ink-2 text-[13px]">Loading…</p>;

  // Decisions waiting on the owner — leave requests plus enquiries passed
  // up — merge into one list, first on the page, and only rendered at
  // all when there's something in it.
  const decisionCount = data.pendingLeaveCount + data.passedToOwner.length;

  return (
    <div className="flex flex-col gap-6">
      {decisionCount > 0 && (
        <DashboardCard
          title="Decisions waiting on you"
          badge={`${decisionCount}`}
          tone="warn"
          emptyText=""
        >
          {data.pendingLeaveCount > 0 && (
            <Row
              href="/owner/leave"
              primary="Leave requests"
              secondary="Waiting on your approval"
              tag={`${data.pendingLeaveCount} awaiting approval`}
              tagTone="warn"
            />
          )}
          {data.passedToOwner.map((e) => (
            <Row
              key={e.id}
              href={`/admin/enquiries/${e.id}`}
              primary={toStartCase(e.customers.name)}
              secondary={e.closure_explanation?.slice(0, 70) + '…'}
              kind="enquiry"
            />
          ))}
        </DashboardCard>
      )}

      {/* This month — one bordered strip of cells, Total last with a
          heavier rule and an accent top edge. No colored tiles. */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 mb-1.5">This month</p>
        <div className="bg-surface border border-rule flex flex-wrap">
          {CATEGORY_CELLS.map((c) => (
            <div key={c.key} className="border-r border-rule last:border-r-0 flex-1 min-w-[110px]">
              <StatCell
                label={c.label}
                count={data.salesByCategory[c.key].count}
                value={data.salesByCategory[c.key].count > 0 ? formatINR(data.salesByCategory[c.key].revenue) : '—'}
              />
            </div>
          ))}
          <div className="border-l-2 border-l-accent flex-1 min-w-[110px]">
            <StatCell label="Total" count={data.salesTotal.count} value={formatINR(data.salesTotal.revenue)} />
          </div>
        </div>
      </div>

      {/* Money outstanding — the owner's highest-value module: a compact
          table, not five separate cards. */}
      <div className="bg-surface border border-rule">
        <div className="flex justify-between items-center gap-2 px-4 py-3 border-b border-rule">
          <h3 className="font-condensed text-[15px] uppercase tracking-[0.06em]">Payments outstanding</h3>
          <span className="text-[13px] font-semibold tabular-nums">
            {formatINR(data.paymentsOutstanding.reduce((sum, o) => sum + o.totalBalance, 0))} total
          </span>
        </div>
        {data.paymentsOutstanding.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-2">Nothing outstanding.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-inset">
                  <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Customer</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Purchases</th>
                  <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Last contacted</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Amount</th>
                  <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Age</th>
                </tr>
              </thead>
              <tbody>
                {data.paymentsOutstanding.map((o) => {
                  const overdue = daysAgo(o.oldestCreatedAt) >= 7;
                  return (
                    <tr key={o.phoneNumber} className="border-t border-divider hover:bg-accent-tint">
                      <td className="py-2.5 px-4">
                        <a href={`/admin/customers?phone=${encodeURIComponent(o.phoneNumber)}`} className="font-semibold hover:underline">
                          {toStartCase(o.name)}
                        </a>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-ink-2">{o.orderCount}</td>
                      <td className="py-2.5 px-3">
                        {o.lastPaymentCallAt ? (
                          <span className="text-ink-2">last called {daysAgo(o.lastPaymentCallAt)}d ago</span>
                        ) : (
                          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] px-1.5 py-0.5 bg-danger-tint text-danger">never called</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold tabular-nums">{formatINR(o.totalBalance)}</td>
                      <td className={`py-2.5 px-4 text-right tabular-nums ${overdue ? 'text-danger font-semibold' : 'text-ink-2'}`}>
                        {daysAgo(o.oldestCreatedAt)}d
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DashboardCard
          title="Commercial & vessel enquiries"
          badge={data.commercialVesselEnquiries.length > 0 ? `${data.commercialVesselEnquiries.length}` : undefined}
          emptyText="None open right now."
          viewAllHref="/admin/enquiries"
          shownCount={Math.min(5, data.commercialVesselEnquiries.length)}
          totalCount={data.commercialVesselEnquiries.length}
        >
          {data.commercialVesselEnquiries.slice(0, 5).map((e) => (
            <Row
              key={e.id}
              href={`/admin/enquiries/${e.id}`}
              primary={toStartCase(e.customers.name)}
              secondary={`${toStartCase(e.enquiry_product_interest || '')} · ${daysAgo(e.created_at)}d open`}
              kind="enquiry"
            />
          ))}
        </DashboardCard>

        <DashboardCard
          title="Jobs to dispatch"
          emptyText="Nothing waiting on a technician."
          viewAllLinks={[
            { label: 'New installation', href: '/admin/installations' },
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
                primary={toStartCase(t.customers.name)}
                secondary={t.enquiry_product_interest ? toStartCase(t.enquiry_product_interest) : t.customers.phone_number}
                tag={age >= 3 ? `${age}d overdue` : `${age}d`}
                tagTone={age >= 3 ? 'danger' : 'neutral'}
                kind={t.kind}
              />
            );
          })}
        </DashboardCard>
      </div>

      <WeekSchedule days={data.scheduleDays} weekJobs={data.weekJobs} staff={staff} />
    </div>
  );
}
