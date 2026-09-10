'use client';

import Link from 'next/link';
import { todayIST, halfDayNowIST } from '@/lib/dates';

// Small building blocks shared by both AdminDashboard and OwnerDashboard.

export interface StaffMember {
  id: string;
  name: string;
}

// Defaults to today and whatever half-day slot it actually is right now
// (same "book it now" convention New Service's immediate assignment
// already uses) — a bare '' date/'morning' regardless of the actual time
// made the admin fix both fields by hand on almost every assignment.
export function emptyAssignForm(): { assignedToId: string; bookedDate: string; bookedHalfDay: string; location: string } {
  return { assignedToId: '', bookedDate: todayIST(), bookedHalfDay: halfDayNowIST(), location: 'home' };
}

export function DashboardCard({
  title,
  badge,
  badgeColor,
  emptyText,
  viewAllHref,
  viewAllLinks,
  shownCount,
  totalCount,
  highlight,
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
  // How many of the total matching rows this card is actually showing
  // (every card here truncates to its top 5) — rendered as "4/10" next
  // to View all so it's obvious there's more to see, not just a list
  // that happens to stop at 5.
  shownCount?: number;
  totalCount?: number;
  // A stronger red border/tint for a card that needs the owner's eye
  // regardless of badge count — e.g. any payment outstanding at all.
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children;
  const showCount = totalCount != null && totalCount > 0;
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border ${highlight ? 'border-red-300 bg-red-50/40' : 'border-gray-200'}`}>
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {badge && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{badge}</span>}
      </div>
      {isEmpty ? <p className="text-sm text-gray-500">{emptyText}</p> : children}
      {(viewAllHref || viewAllLinks) && (
        <div className="flex justify-between items-center mt-2 gap-2">
          {viewAllHref && (
            <Link href={viewAllHref} className="text-sm text-blue-600 hover:underline">
              View all →
            </Link>
          )}
          {viewAllLinks && (
            <div className="flex gap-3">
              {viewAllLinks.map((l) => (
                <Link key={l.href} href={l.href} className="text-sm text-blue-600 hover:underline">
                  {l.label} →
                </Link>
              ))}
            </div>
          )}
          {showCount && <span className="text-xs text-gray-500">{shownCount}/{totalCount}</span>}
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
        {secondary && <p className="text-xs text-gray-500">{secondary}</p>}
      </div>
      {tag && <span className={`text-xs ${tagColor ?? 'text-gray-900'}`}>{tag}</span>}
    </Link>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
