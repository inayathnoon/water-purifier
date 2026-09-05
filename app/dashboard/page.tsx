'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, signOut, type User } from '@/lib/auth';
import { daysAgoIST } from '@/lib/dates';

interface AdminDashboardData {
  newEnquiries: { id: string; created_at: string; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
  oldEnquiryCount: number;
  jobsToDispatch: { id: string; kind: string; created_at: string; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
  overdueDispatchCount: number;
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
  paymentsOutstanding: { name: string; phoneNumber: string; totalBalance: number; orderCount: number }[];
  overdueCallCount: number;
  overdueConfirmationCount: number;
  satisfactionCallsDue: { orderId: string; installationDate: string; customers: { name: string; phone_number: string } }[];
}

interface OwnerDashboardData {
  todaysJobs: { id: string; kind: string; customers: { name: string } }[];
  whoIsBusy: Record<string, number>;
  monthRevenue: { sold: number; discount: number; collected: number };
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

const daysAgo = daysAgoIST;

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((currentUser) => {
      if (cancelled) return;
      if (!currentUser) {
        router.push('/auth/login');
        return;
      }
      // §15.2: a technician should see today's jobs and nothing else —
      // no dashboard detour on the way there.
      if (currentUser.role === 'service_staff') {
        router.replace('/staff/jobs');
        return;
      }
      // The app's own developer/maintainer sees a maintenance panel, not
      // the business dashboard — a separate account/page from 'owner'.
      if (currentUser.role === 'developer') {
        router.replace('/developer');
        return;
      }
      setUser(currentUser);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth/login');
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-6xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900">Water Purifier Service</h1>
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="text-sm text-gray-900">
              {user.name} ({user.role})
            </span>
            <button
              onClick={handleSignOut}
              className="px-3 py-1.5 text-sm text-gray-900 bg-white border border-gray-300 rounded-md hover:bg-gray-50 shrink-0"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {user.role === 'admin' ? <AdminDashboard /> : <OwnerDashboard />}
      </main>
    </div>
  );
}

interface StaffMember {
  id: string;
  name: string;
}

const emptyAssignForm = { assignedToId: '', bookedDate: '', bookedHalfDay: 'morning', location: 'home' };

function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState(emptyAssignForm);
  const [assignError, setAssignError] = useState('');
  const [assigning, setAssigning] = useState(false);

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
    setAssigningId(id);
    setAssignForm(emptyAssignForm);
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
    loadDashboard();
  };

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Today — everyone you need to call</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/admin/enquiries" className="text-blue-600 hover:underline">Enquiries</Link>
          <Link href="/admin/customers" className="text-blue-600 hover:underline">Customers</Link>
          <Link href="/admin/orders" className="text-blue-600 hover:underline">Orders</Link>
          <Link href="/admin/products" className="text-blue-600 hover:underline">Products</Link>
          <Link href="/admin/service-calls" className="text-blue-600 hover:underline">Service Calls</Link>
          <Link
            href="/admin/enquiries?new=1"
            className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            + New Enquiry
          </Link>
          <Link
            href="/admin/installations?new=1"
            className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            + New Purchase
          </Link>
          <Link
            href="/admin/service-calls?new=1"
            className="px-3 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700"
          >
            + New Service
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DashboardCard
          title="New enquiries"
          badge={data.oldEnquiryCount > 0 ? `${data.oldEnquiryCount} over 14 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing open."
          viewAllHref="/admin/enquiries"
        >
          {data.newEnquiries.slice(0, 5).map((e) => (
            <Row
              key={e.id}
              href={`/admin/enquiries/${e.id}`}
              primary={e.customers.name}
              secondary={e.enquiry_product_interest || e.customers.phone_number}
              tag={daysAgo(e.created_at) >= 14 ? `${daysAgo(e.created_at)}d — decide now` : `${daysAgo(e.created_at)}d`}
              tagColor={daysAgo(e.created_at) >= 14 ? 'text-red-600' : 'text-gray-900'}
            />
          ))}
        </DashboardCard>

        <DashboardCard
          title="Jobs to dispatch"
          badge={data.overdueDispatchCount > 0 ? `${data.overdueDispatchCount} over 3 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing waiting on a technician."
          viewAllLinks={[
            { label: 'Installations', href: '/admin/installations' },
            { label: 'Service Calls', href: '/admin/service-calls' },
          ]}
        >
          {data.jobsToDispatch.slice(0, 5).map((t) => {
            const age = daysAgo(t.created_at);
            return (
              <div key={t.id} className="py-2 border-b last:border-0">
                <div className="flex justify-between items-center gap-2">
                  <div>
                    <p className="text-sm font-medium">{t.customers.name}</p>
                    <p className="text-xs text-gray-900">{t.enquiry_product_interest || t.customers.phone_number}</p>
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
                    <select
                      required
                      className="border rounded px-2 py-1.5 w-full text-sm"
                      value={assignForm.assignedToId}
                      onChange={(e) => setAssignForm({ ...assignForm, assignedToId: e.target.value })}
                    >
                      <option value="">Assign to...</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        required
                        className="border rounded px-2 py-1.5 flex-1 text-sm"
                        value={assignForm.bookedDate}
                        onChange={(e) => setAssignForm({ ...assignForm, bookedDate: e.target.value })}
                      />
                      <select
                        className="border rounded px-2 py-1.5 text-sm"
                        value={assignForm.bookedHalfDay}
                        onChange={(e) => setAssignForm({ ...assignForm, bookedHalfDay: e.target.value })}
                      >
                        <option value="morning">Morning</option>
                        <option value="afternoon">Afternoon</option>
                        <option value="evening">Evening</option>
                      </select>
                      {/* Installations always happen at the customer's home
                          — only a service visit can be brought to the office. */}
                      {t.kind !== 'installation' && (
                        <select
                          className="border rounded px-2 py-1.5 text-sm"
                          value={assignForm.location}
                          onChange={(e) => setAssignForm({ ...assignForm, location: e.target.value })}
                        >
                          <option value="home">Home</option>
                          <option value="office">Office</option>
                        </select>
                      )}
                    </div>
                    <button
                      disabled={assigning}
                      className="w-full py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      {assigning ? 'Assigning...' : 'Confirm assignment'}
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </DashboardCard>

        <DashboardCard
          title="Confirm finished work"
          badge={data.overdueConfirmationCount > 0 ? `${data.overdueConfirmationCount} over 7 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing waiting on a confirmation call."
          viewAllHref="/admin/orders"
        >
          {[
            ...data.awaitingConfirmation.slice(0, 5).map((t) => {
              const age = daysAgo(t.actual_date);
              return (
                <Row
                  key={`job-${t.id}`}
                  href={t.kind === 'installation' ? '/admin/installations' : `/admin/service-calls?highlightTicket=${t.id}`}
                  primary={t.customers.name}
                  secondary={t.customers.phone_number}
                  tag={`${t.kind === 'installation' ? 'Installation' : 'Service visit'} · ${age}d${age >= 7 ? ' — overdue' : ''}`}
                  tagColor={age >= 7 ? 'text-red-600' : undefined}
                />
              );
            }),
            // Separate from the above — installed within the last 30 days,
            // still needing the follow-up satisfaction call (not the
            // original "was it done right" confirmation).
            ...data.satisfactionCallsDue.slice(0, 5).map((s) => (
              <Row
                key={`satisfaction-${s.orderId}`}
                href="/admin/orders"
                primary={s.customers.name}
                secondary={s.customers.phone_number}
                tag={`Follow-up call · installed ${daysAgo(s.installationDate)}d ago`}
              />
            )),
          ]}
        </DashboardCard>

        <DashboardCard
          title="Payments outstanding"
          badge={data.overdueCallCount > 0 ? `${data.overdueCallCount} overdue for a call` : undefined}
          badgeColor="bg-orange-100 text-orange-800"
          emptyText="Nothing owed. Nice."
          viewAllHref="/admin/orders"
        >
          {data.paymentsOutstanding.slice(0, 5).map((o) => (
            <Row
              key={o.phoneNumber}
              href={`/admin/customers?phone=${encodeURIComponent(o.phoneNumber)}`}
              primary={o.name}
              secondary={o.orderCount > 1 ? `${o.orderCount} orders` : o.phoneNumber}
              tag={`₹${o.totalBalance} owed`}
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
    </div>
  );
}

function weekDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) + ' ' + dateStr.slice(5);
}

function OwnerDashboard() {
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

  const days = weekDates(data.weekStart, data.weekEnd);
  const jobsByStaffAndDay = new Map<string, Map<string, typeof data.weekJobs>>();
  for (const job of data.weekJobs) {
    if (!job.assigned_to_id) continue;
    if (!jobsByStaffAndDay.has(job.assigned_to_id)) jobsByStaffAndDay.set(job.assigned_to_id, new Map());
    const byDay = jobsByStaffAndDay.get(job.assigned_to_id)!;
    if (!byDay.has(job.booked_date)) byDay.set(job.booked_date, []);
    byDay.get(job.booked_date)!.push(job);
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Business overview</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/admin/enquiries" className="text-green-700 hover:underline">Enquiries</Link>
          <Link href="/admin/installations" className="text-green-700 hover:underline">New Purchase</Link>
          <Link href="/admin/customers" className="text-green-700 hover:underline">Customers</Link>
          <Link href="/admin/orders" className="text-green-700 hover:underline">Orders</Link>
          <Link href="/admin/products" className="text-green-700 hover:underline">Products</Link>
          <Link href="/admin/service-calls" className="text-green-700 hover:underline">Service Calls</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard label="Jobs today" value={String(data.todaysJobs.length)} />
        <StatCard label="Sold this month" value={`₹${data.monthRevenue.sold.toFixed(2)}`} />
        <StatCard label="Collected this month" value={`₹${data.monthRevenue.collected.toFixed(2)}`} />
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
          <p className="text-sm text-gray-900 mt-1">Margin sits between list price and sold price (§7.6)</p>
        </DashboardCard>

        <DashboardCard
          title="Enquiries passed to you"
          emptyText="None waiting on you."
          viewAllHref="/admin/enquiries"
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
        >
          {data.paymentsOutstanding.slice(0, 5).map((o) => {
            const overdue = daysAgo(o.oldestCreatedAt) >= 7;
            return (
              <Row
                key={o.phoneNumber}
                href={`/admin/customers?phone=${encodeURIComponent(o.phoneNumber)}`}
                primary={o.name}
                secondary={
                  (o.orderCount > 1 ? `${o.orderCount} orders · ` : '') +
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
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          This Week ({data.weekStart} – {data.weekEnd})
        </h2>
        <div className="bg-white rounded-lg shadow p-4 mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-3 whitespace-nowrap">Staff</th>
                {days.map((d) => (
                  <th key={d} className="text-left py-2 px-2 whitespace-nowrap">
                    {dayLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{s.name}</td>
                  {days.map((d) => {
                    const jobs = jobsByStaffAndDay.get(s.id)?.get(d) ?? [];
                    return (
                      <td key={d} className="py-2 px-2">
                        {jobs.map((j) => (
                          <div key={j.id} className="text-xs mb-1 whitespace-nowrap">
                            <span className={j.kind === 'installation' ? 'text-blue-700' : 'text-orange-700'}>
                              {j.kind === 'installation' ? 'I' : 'S'}
                            </span>{' '}
                            {j.customers.name}
                            <span className="text-gray-900"> ({j.booked_half_day[0].toUpperCase()})</span>
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DashboardCard
          title="Jobs to Dispatch"
          emptyText="Nothing waiting on a technician."
          viewAllLinks={[
            { label: 'Installations', href: '/admin/installations' },
            { label: 'Service Calls', href: '/admin/service-calls' },
          ]}
        >
          {data.jobsToDispatch.slice(0, 5).map((t) => {
            const age = daysAgo(t.created_at);
            return (
              <div key={t.id} className="py-2 border-b last:border-0">
                <div className="flex justify-between items-center gap-2">
                  <div>
                    <p className="text-sm font-medium">{t.customers.name}</p>
                    <p className="text-xs text-gray-900">{t.enquiry_product_interest || t.customers.phone_number}</p>
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
                    <select
                      required
                      className="border rounded px-2 py-1.5 w-full text-sm"
                      value={assignForm.assignedToId}
                      onChange={(e) => setAssignForm({ ...assignForm, assignedToId: e.target.value })}
                    >
                      <option value="">Assign to...</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        required
                        className="border rounded px-2 py-1.5 flex-1 text-sm"
                        value={assignForm.bookedDate}
                        onChange={(e) => setAssignForm({ ...assignForm, bookedDate: e.target.value })}
                      />
                      <select
                        className="border rounded px-2 py-1.5 text-sm"
                        value={assignForm.bookedHalfDay}
                        onChange={(e) => setAssignForm({ ...assignForm, bookedHalfDay: e.target.value })}
                      >
                        <option value="morning">Morning</option>
                        <option value="afternoon">Afternoon</option>
                        <option value="evening">Evening</option>
                      </select>
                      {t.kind !== 'installation' && (
                        <select
                          className="border rounded px-2 py-1.5 text-sm"
                          value={assignForm.location}
                          onChange={(e) => setAssignForm({ ...assignForm, location: e.target.value })}
                        >
                          <option value="home">Home</option>
                          <option value="office">Office</option>
                        </select>
                      )}
                    </div>
                    <button
                      disabled={assigning}
                      className="w-full py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      {assigning ? 'Assigning...' : 'Confirm assignment'}
                    </button>
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

function DashboardCard({
  title,
  badge,
  badgeColor,
  emptyText,
  viewAllHref,
  viewAllLinks,
  children,
}: {
  title: string;
  badge?: string;
  badgeColor?: string;
  emptyText: string;
  viewAllHref?: string;
  // For a card that mixes two ticket kinds living on two different pages
  // (Jobs to Dispatch: installations + service visits) — a single "View
  // all" link can only ever show one of them, silently hiding the other.
  viewAllLinks?: { label: string; href: string }[];
  children: React.ReactNode;
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {badge && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{badge}</span>}
      </div>
      {isEmpty ? <p className="text-sm text-gray-900">{emptyText}</p> : children}
      {viewAllHref && (
        <Link href={viewAllHref} className="block text-sm text-blue-600 hover:underline mt-2">
          View all →
        </Link>
      )}
      {viewAllLinks && (
        <div className="flex gap-3 mt-2">
          {viewAllLinks.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-blue-600 hover:underline">
              {l.label} →
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  href,
  primary,
  secondary,
  tag,
  tagColor,
}: {
  href: string;
  primary: string;
  secondary?: string;
  tag?: string;
  tagColor?: string;
}) {
  return (
    <Link href={href} className="flex justify-between items-center py-2 border-b last:border-0 hover:bg-gray-50 -mx-1 px-1 rounded">
      <div>
        <p className="text-sm font-medium">{primary}</p>
        {secondary && <p className="text-xs text-gray-900">{secondary}</p>}
      </div>
      {tag && <span className={`text-xs ${tagColor ?? 'text-gray-900'}`}>{tag}</span>}
    </Link>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-900">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
