// The business operates in India Standard Time; the server process this
// runs on doesn't necessarily agree (Railway's runtime defaults to UTC).
// "How many days old is this" has to mean IST calendar days — today's
// IST date minus the record's IST date — not raw elapsed hours (which
// reads as "0 days" for something 23 hours old if it crossed midnight)
// and not whatever timezone happens to be local to wherever this code
// runs. Using this same function on both the client and the server
// guarantees they always agree, even though a real user's browser is
// already in IST and wouldn't otherwise need the explicit shift.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toISTCalendarDayNumber(d: Date): number {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
}

/** Calendar days between `dateStr` and now (or `now`, if given), in IST. */
export function daysAgoIST(dateStr: string, now: Date = new Date()): number {
  return Math.floor((toISTCalendarDayNumber(now) - toISTCalendarDayNumber(new Date(dateStr))) / 86400000);
}

/**
 * Today's date (YYYY-MM-DD) in IST, not the server runtime's own
 * timezone. Matters for anything compared against a plain DATE column
 * (booked_date, etc.) — a server running in UTC thinks it's still
 * "yesterday" for the first 5.5 hours of every actual IST day.
 */
export function todayIST(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
}

/** ISO timestamp for `daysBack` days ago, at IST midnight, as a UTC instant. */
export function daysAgoISTThreshold(daysBack: number, now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnightUTC = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysBack);
  return new Date(istMidnightUTC - IST_OFFSET_MS).toISOString();
}

/** ISO timestamp for the 1st of the current IST month, as a UTC instant. */
export function monthStartISTThreshold(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const istMonthStartUTC = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1);
  return new Date(istMonthStartUTC - IST_OFFSET_MS).toISOString();
}

/**
 * Which half of the day it currently is, in IST — used when a job is
 * booked as already decided/attended at creation time and needs a
 * booked_half_day value with no separate time picker in that form.
 */
export function halfDayNowIST(now: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const hour = ist.getUTCHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
