'use client';

// The next 7 days, staff as rows — used on both the admin and owner
// dashboards, identical except admin's cells are clickable (to
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

interface WeekScheduleProps<T extends WeekJobBase> {
  weekStart: string;
  weekEnd: string;
  weekJobs: T[];
  staff: WeekScheduleStaff[];
  // Admin only — clicking a booked job opens its edit form. Owner's
  // schedule is read-only context, so this is left undefined there.
  onJobClick?: (job: T) => void;
  activeJobId?: string | null;
}

export default function WeekSchedule<T extends WeekJobBase>({
  weekStart,
  weekEnd,
  weekJobs,
  staff,
  onJobClick,
  activeJobId,
}: WeekScheduleProps<T>) {
  const days = weekDates(weekStart, weekEnd);
  const jobsByStaffAndDay = new Map<string, Map<string, T[]>>();
  for (const job of weekJobs) {
    if (!job.assigned_to_id) continue;
    if (!jobsByStaffAndDay.has(job.assigned_to_id)) jobsByStaffAndDay.set(job.assigned_to_id, new Map());
    const byDay = jobsByStaffAndDay.get(job.assigned_to_id)!;
    if (!byDay.has(job.booked_date)) byDay.set(job.booked_date, []);
    byDay.get(job.booked_date)!.push(job);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        This Week ({weekStart} – {weekEnd})
      </h2>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 overflow-x-auto">
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
                      {jobs.map((j) =>
                        onJobClick ? (
                          <button
                            key={j.id}
                            onClick={() => onJobClick(j)}
                            disabled={j.status !== 'booked'}
                            className={`block text-xs mb-1 whitespace-nowrap text-left ${
                              j.status === 'booked' ? 'hover:underline cursor-pointer' : 'cursor-default'
                            } ${activeJobId === j.id ? 'font-semibold underline' : ''}`}
                          >
                            <span className={j.kind === 'installation' ? 'text-blue-700' : 'text-orange-700'}>
                              {j.kind === 'installation' ? 'I' : 'S'}
                            </span>{' '}
                            {j.customers.name}
                            <span className="text-gray-900"> ({j.booked_half_day[0].toUpperCase()})</span>
                          </button>
                        ) : (
                          <div key={j.id} className="text-xs mb-1 whitespace-nowrap">
                            <span className={j.kind === 'installation' ? 'text-blue-700' : 'text-orange-700'}>
                              {j.kind === 'installation' ? 'I' : 'S'}
                            </span>{' '}
                            {j.customers.name}
                            <span className="text-gray-900"> ({j.booked_half_day[0].toUpperCase()})</span>
                          </div>
                        )
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
