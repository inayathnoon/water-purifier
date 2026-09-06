'use client';

import Link from 'next/link';

// Small building blocks shared by both AdminDashboard and OwnerDashboard.

export interface StaffMember {
  id: string;
  name: string;
}

export const emptyAssignForm = { assignedToId: '', bookedDate: '', bookedHalfDay: 'morning', location: 'home' };

export function DashboardCard({
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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

export function Row({
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

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <p className="text-sm text-gray-900">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
