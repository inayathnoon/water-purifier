'use client';

import Link from 'next/link';
import { todayIST, halfDayNowIST } from '@/lib/dates';

// Small building blocks shared by both AdminDashboard and OwnerDashboard,
// and reused by AgeLabel/TypeTag so the grammar and kind vocabulary are
// each defined exactly once.

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

export type Tone = 'neutral' | 'danger' | 'warn' | 'ok';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-2',
  danger: 'text-danger',
  warn: 'text-warn',
  ok: 'text-ok',
};

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-inset text-ink-2',
  danger: 'bg-danger-tint text-danger',
  warn: 'bg-warn-tint text-warn',
  ok: 'bg-ok-tint text-ok',
};

export function DashboardCard({
  title,
  badge,
  tone = 'neutral',
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
  tone?: Tone;
  emptyText: string;
  viewAllHref?: string;
  // For a card that mixes two ticket kinds living on two different pages
  // (Jobs to dispatch: installations + service visits) — a single "View
  // all" link can only ever show one of them, silently hiding the other.
  viewAllLinks?: { label: string; href: string }[];
  // How many of the total matching rows this card is actually showing
  // (every card here truncates to its top 5) — rendered as "4/10" next
  // to View all so it's obvious there's more to see, not just a list
  // that happens to stop at 5.
  shownCount?: number;
  totalCount?: number;
  // A card that needs attention regardless of badge count gets a 2px
  // danger top edge — never a full-card tint, so danger stays meaning
  // "past due", not "this module is important".
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children;
  const showCount = totalCount != null && totalCount > 0;
  return (
    <div className={`bg-surface border border-rule ${highlight ? 'border-t-2 border-t-danger' : ''}`}>
      <div className="flex justify-between items-center gap-2 px-4 py-3 border-b border-rule">
        <h3 className="font-condensed text-[15px] uppercase tracking-[0.06em]">{title}</h3>
        {badge && <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 shrink-0 ${TONE_BADGE[tone]}`}>{badge}</span>}
      </div>
      {isEmpty ? (
        <p className="px-4 py-3 text-[13px] text-ink-2">{emptyText}</p>
      ) : (
        <div className="px-4">{children}</div>
      )}
      {(viewAllHref || viewAllLinks) && !isEmpty && (
        <div className="flex justify-between items-center gap-2 px-4 py-2.5 border-t border-rule">
          {viewAllHref && (
            <Link href={viewAllHref} className="text-[13px] text-accent-deep hover:underline">
              View all →
            </Link>
          )}
          {viewAllLinks && (
            <div className="flex gap-3">
              {viewAllLinks.map((l) => (
                <Link key={l.href} href={l.href} className="text-[13px] text-accent-deep hover:underline">
                  {l.label} →
                </Link>
              ))}
            </div>
          )}
          {showCount && <span className="text-[13px] text-ink-2 tabular-nums">{shownCount}/{totalCount}</span>}
        </div>
      )}
    </div>
  );
}

// One row anatomy everywhere: [type tag] Primary · secondary ... [age] [action].
// The secondary line truncates on a min-w-0 flex child so a long tag string
// can never overlap it (the old bug: an unconstrained tag ran over the
// wrapping secondary text on narrow cards).
export function Row({
  href,
  primary,
  secondary,
  tag,
  tagTone = 'neutral',
  kind,
}: {
  href: string;
  primary: string;
  secondary?: string;
  tag?: string;
  tagTone?: Tone;
  kind?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 py-3 border-b border-divider last:border-0 hover:bg-accent-tint -mx-1 px-1"
      style={{ minHeight: 52 }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold truncate flex items-center gap-1.5">
          {kind && <TypeTag kind={kind} />}
          {primary}
        </p>
        {secondary && <p className="text-[13px] text-ink-2 truncate">{secondary}</p>}
      </div>
      {tag && <span className={`text-[13px] font-medium shrink-0 whitespace-nowrap ${TONE_TEXT[tagTone]}`}>{tag}</span>}
    </Link>
  );
}

// Replaces the old, unused StatCard — a labelled number as one cell of a
// bordered strip (This month, etc.), not a floating card of its own.
export function StatCell({ label, count, value }: { label: string; count?: number; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">{label}</p>
      {count != null && <p className="text-[28px] font-bold tabular-nums leading-tight mt-1">{count}</p>}
      <p className="text-[15px] text-ink-2 tabular-nums">{value}</p>
    </div>
  );
}

// One age/urgency grammar for the whole app — every card and list computes
// a tone + word choice from this vocabulary instead of writing its own
// ("1 over 3 days", "— decide now", "overdue for a call", ...).
export function AgeLabel({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return <span className={`text-[13px] font-medium whitespace-nowrap ${TONE_TEXT[tone]}`}>{label}</span>;
}

export function daysOverdueLabel(days: number, overdueAt: number, verb = 'overdue'): { label: string; tone: Tone } {
  if (days >= overdueAt) return { label: `${days}d ${verb}`, tone: 'danger' };
  return { label: `${days}d`, tone: 'neutral' };
}

const KIND_LABEL: Record<string, string> = {
  installation: 'Installation',
  service_visit: 'Service visit',
  enquiry: 'Enquiry',
  payment: 'Payment',
  follow_up: 'Follow-up',
};

const KIND_TONE: Record<string, string> = {
  installation: 'bg-accent text-white',
  service_visit: 'bg-ink text-white',
  enquiry: 'bg-inset text-ink-2',
  payment: 'bg-inset text-ink-2',
  follow_up: 'bg-inset text-ink-2',
};

// installation/service_visit/enquiry/payment/follow_up — defined once,
// used by every row that needs to say what kind of thing it is.
export function TypeTag({ kind }: { kind: string }) {
  const label = KIND_LABEL[kind] ?? kind;
  const cls = KIND_TONE[kind] ?? 'bg-inset text-ink-2';
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-[0.05em] px-1.5 py-0.5 shrink-0 ${cls}`}>
      {label}
    </span>
  );
}
