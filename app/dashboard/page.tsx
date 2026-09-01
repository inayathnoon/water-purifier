'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, signOut, type User } from '@/lib/auth';

interface AdminDashboardData {
  newEnquiries: { id: string; created_at: string; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
  oldEnquiryCount: number;
  awaitingConfirmation: { id: string; kind: string; actual_date: string; customers: { name: string; phone_number: string } }[];
  serviceCallsDue: { id: string; warranty_expires_at: string; customers: { name: string; phone_number: string } }[];
  paymentsOutstanding: { id: string; sold_price: number; discount: number; balance_owed: number; last_payment_call_at: string | null; tickets: { customers: { name: string; phone_number: string } } }[];
  overdueCallCount: number;
  overdueConfirmationCount: number;
}

interface OwnerDashboardData {
  todaysJobs: { id: string; kind: string; customers: { name: string } }[];
  whoIsBusy: Record<string, number>;
  monthRevenue: { sold: number; discount: number; collected: number };
  pendingLeaveCount: number;
  passedToOwner: { id: string; closure_explanation: string; customers: { name: string; phone_number: string } }[];
  overdueOrders: { id: string; balance_owed: number; created_at: string; tickets: { customers: { name: string; phone_number: string } } }[];
  commercialVesselEnquiries: { id: string; created_at: string; enquiry_product_interest: string; customers: { name: string; phone_number: string } }[];
}

function daysAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

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

function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/dashboard')
      .then((res) => res.json())
      .then((d) => !cancelled && setData(d));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Today — everyone you need to call</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/admin/orders" className="text-blue-600 hover:underline">Orders</Link>
          <Link href="/admin/products" className="text-blue-600 hover:underline">Products</Link>
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
          title="Confirm finished work"
          badge={data.overdueConfirmationCount > 0 ? `${data.overdueConfirmationCount} over 7 days` : undefined}
          badgeColor="bg-red-100 text-red-800"
          emptyText="Nothing waiting on a confirmation call."
          viewAllHref="/admin/installations"
        >
          {data.awaitingConfirmation.slice(0, 5).map((t) => {
            const age = daysAgo(t.actual_date);
            return (
              <Row
                key={t.id}
                href={t.kind === 'installation' ? '/admin/installations' : '/admin/service-calls'}
                primary={t.customers.name}
                secondary={t.customers.phone_number}
                tag={`${t.kind === 'installation' ? 'Installation' : 'Service visit'} · ${age}d${age >= 7 ? ' — overdue' : ''}`}
                tagColor={age >= 7 ? 'text-red-600' : undefined}
              />
            );
          })}
        </DashboardCard>

        <DashboardCard title="Yearly service calls due" emptyText="None due." viewAllHref="/admin/service-calls">
          {data.serviceCallsDue.slice(0, 5).map((t) => (
            <Row key={t.id} href="/admin/service-calls" primary={t.customers.name} secondary={t.customers.phone_number} />
          ))}
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
              key={o.id}
              href="/admin/orders"
              primary={o.tickets.customers.name}
              secondary={`Discount: ₹${o.discount}`}
              tag={`₹${o.balance_owed} owed`}
              tagColor="text-red-600"
            />
          ))}
        </DashboardCard>
      </div>
    </div>
  );
}

function OwnerDashboard() {
  const [data, setData] = useState<OwnerDashboardData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/owner/dashboard')
      .then((res) => res.json())
      .then((d) => !cancelled && setData(d));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Business overview</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/admin/enquiries" className="text-green-700 hover:underline">Enquiries</Link>
          <Link href="/admin/installations" className="text-green-700 hover:underline">Installations</Link>
          <Link href="/admin/orders" className="text-green-700 hover:underline">Orders</Link>
          <Link href="/admin/products" className="text-green-700 hover:underline">Products</Link>
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
          title="Overdue 7+ days"
          emptyText="Nothing overdue."
          viewAllHref="/admin/orders"
        >
          {data.overdueOrders.slice(0, 5).map((o) => (
            <Row
              key={o.id}
              href="/admin/orders"
              primary={o.tickets.customers.name}
              secondary={`${daysAgo(o.created_at)} days`}
              tag={`₹${o.balance_owed}`}
              tagColor="text-red-600"
            />
          ))}
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
  children,
}: {
  title: string;
  badge?: string;
  badgeColor?: string;
  emptyText: string;
  viewAllHref?: string;
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
