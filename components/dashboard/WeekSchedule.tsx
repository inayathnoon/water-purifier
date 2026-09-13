'use client';

// Today plus the next couple of days, skipping Sunday (see
// nextWorkingDaysIST()) — staff as rows — used on both the admin and
// owner dashboards, identical except admin's cells are clickable (to
// reassign/edit a booked job in place) and owner's are read-only.

// Admin's weekJobs carries extra fields (location, a stricter status) that
// owner's leaner data doesn't — generic over the caller's own job shape so
// onJobClick hands back exactly what was passed in, not a lossy subset.
export interface WeekJobBase {
  id: string;
  kind: string;
  booked_date: string;
  booked_half_day: string;
  status?: string;
  assigned_to_id: string | null;
  customers: { name: string };
}

interface WeekScheduleStaff {
  id: string;
  name: string;
}

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) + ' ' + dateStr.slice(5);
}

interface WeekScheduleProps<T extends WeekJobBase> {
  // The exact days to show, in order — not necessarily contiguous
  // (Sunday is dropped, so the window can span one day further than
  // `days.length` would otherwise cover).
  days: string[];
  weekJobs: T[];
  staff: WeekScheduleStaff[];
  // Admin only — clicking a booked job opens its edit form. Owner's
  // schedule is read-only context, so this is left undefined there.
  onJobClick?: (job: T) => void;
  activeJobId?: string | null;
}

export default function WeekSchedule<T extends WeekJobBase>({
  days,
  weekJobs,
  staff,
  onJobClick,
  activeJobId,
}: WeekScheduleProps<T>) {
  const HALF_DAY_ORDER: Record<string, number> = { morning: 0, afternoon: 1, evening: 2 };

  const jobsByStaffAndDay = new Map<string, Map<string, T[]>>();
  for (const job of weekJobs) {
    if (!job.assigned_to_id) continue;
    if (!jobsByStaffAndDay.has(job.assigned_to_id)) jobsByStaffAndDay.set(job.assigned_to_id, new Map());
    const byDay = jobsByStaffAndDay.get(job.assigned_to_id)!;
    if (!byDay.has(job.booked_date)) byDay.set(job.booked_date, []);
    byDay.get(job.booked_date)!.push(job);
  }
  // Morning, then Afternoon, then Evening within each day's cell.
  for (const byDay of jobsByStaffAndDay.values()) {
    for (const jobs of byDay.values()) {
      jobs.sort((a, b) => (HALF_DAY_ORDER[a.booked_half_day] ?? 99) - (HALF_DAY_ORDER[b.booked_half_day] ?? 99));
    }
  }

  const rangeLabel = days.length > 1 ? `${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}` : dayLabel(days[0]);
  const isEmpty = weekJobs.length === 0;

  return (
    <div className="bg-surface border border-rule">
      <div className="px-4 py-3 border-b border-rule">
        <h3 className="font-condensed text-[15px] uppercase tracking-[0.06em]">Staff schedule ({rangeLabel})</h3>
      </div>
      {isEmpty ? (
        <p className="px-4 py-3 text-[13px] text-ink-2">No jobs scheduled — assign from the queue above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-inset">
                <th className="text-left py-2 px-4 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Staff</th>
                {days.map((d) => (
                  <th key={d} className="text-left py-2 px-3 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">
                    {dayLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-t border-divider align-top">
                  <td className="py-2.5 px-4 font-semibold whitespace-nowrap">{s.name}</td>
                  {days.map((d) => {
                    const jobs = jobsByStaffAndDay.get(s.id)?.get(d) ?? [];
                    if (jobs.length === 0) {
                      return (
                        <td key={d} className="py-2.5 px-3 text-ink-3">
                          –
                        </td>
                      );
                    }
                    return (
                      <td key={d} className="py-2.5 px-3">
                        {jobs.map((j) => {
                          const tagCls = j.kind === 'installation' ? 'bg-accent text-white' : 'bg-ink text-white';
                          const content = (
                            <>
                              <span className={`text-[10px] font-semibold px-1 py-0.5 ${tagCls}`}>{j.kind === 'installation' ? 'I' : 'S'}</span>{' '}
                              {j.customers.name}
                              <span className="text-ink-2"> ({j.booked_half_day[0].toUpperCase()})</span>
                            </>
                          );
                          return onJobClick ? (
                            <button
                              key={j.id}
                              onClick={() => onJobClick(j)}
                              disabled={j.status !== 'booked'}
                              className={`block mb-1 whitespace-nowrap text-left focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
                                j.status === 'booked' ? 'hover:underline cursor-pointer' : 'cursor-default'
                              } ${activeJobId === j.id ? 'font-semibold underline' : ''}`}
                            >
                              {content}
                            </button>
                          ) : (
                            <div key={j.id} className="mb-1 whitespace-nowrap">
                              {content}
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
