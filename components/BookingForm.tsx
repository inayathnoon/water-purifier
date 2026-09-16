'use client';

import { todayIST } from '@/lib/dates';

// Shared core of every "assign a job to a technician" form in this app —
// staff/date/half-day/location plus the approved-leave warning. Renders
// only the fields, not a <form> wrapper, so each caller keeps its own
// <form onSubmit>, header, and error placement (they vary — a floating
// dashboard card, an inline sub-form, a compact assign row) while the
// actual fields, and any future change to them, live in one place.

export interface BookingFormStaffOption {
  id: string;
  name: string;
  approvedLeave?: { start_date: string; end_date: string }[];
}

// "Others" — a real service_staff account (created via the Developer
// panel's "+ Add Staff", the business's own action, not something the
// app creates for itself) for a job actually done by someone outside
// the three regular technicians: an external contractor, or "something
// else" not worth naming precisely. Recognized purely by this exact
// name — no schema flag, no hardcoded id — so the feature is entirely
// off (this option simply never appears) until that one account exists.
// Bookable and completable through the exact same flow as a real
// technician (so it correctly shows "assigned to Others" and can be
// closed out whenever ready, "giving them time" rather than forcing an
// immediate completion) — the only difference is it never needs a real
// date/half-day, since there's no real schedule to speak of, and it's
// deliberately excluded from the Staff Schedule grid, Leave requests,
// and workload indicators (see the exclusion at each of those call
// sites) since none of those make sense for an unspecified person.
export const OTHERS_STAFF_NAME = 'Others';

export function isOthers(staff: BookingFormStaffOption[], staffId: string): boolean {
  return staff.some((s) => s.id === staffId && s.name === OTHERS_STAFF_NAME);
}

export interface BookingFormValue {
  assignedToId: string;
  bookedDate: string;
  bookedHalfDay: string;
  location: string;
}

/** §11.5: shown as context on the booking form, never as a block. */
export function isOnApprovedLeave(staff: BookingFormStaffOption[], staffId: string, date: string): boolean {
  if (!date) return false;
  const person = staff.find((s) => s.id === staffId);
  return (person?.approvedLeave ?? []).some((l) => date >= l.start_date && date <= l.end_date);
}

interface BookingFormProps {
  staff: BookingFormStaffOption[];
  value: BookingFormValue;
  onChange: (value: BookingFormValue) => void;
  submitLabel: string;
  submitting?: boolean;
  submittingLabel?: string;
  // false for an installation — always at home (§ installations are
  // always home), unlike a service visit where a customer can bring
  // their unit to the office.
  showLocation?: boolean;
  // Rendered between the date row and the leave warning — e.g.
  // installations' "already has N jobs" workload note.
  extra?: React.ReactNode;
  // Smaller text/padding, for a dense inline form (the dashboard's).
  compact?: boolean;
}

export default function BookingForm({
  staff,
  value,
  onChange,
  submitLabel,
  submitting = false,
  submittingLabel,
  showLocation = true,
  extra,
  compact = false,
}: BookingFormProps) {
  const fieldClass = compact ? 'border rounded px-2 py-1.5 text-sm' : 'border rounded px-3 py-2';
  const othersSelected = isOthers(staff, value.assignedToId);

  return (
    <>
      <select
        required
        className={`${fieldClass} w-full`}
        value={value.assignedToId}
        onChange={(e) => {
          const assignedToId = e.target.value;
          // Others has no real schedule — silently fill in sensible
          // defaults the moment it's picked, since the fields asking for
          // them are about to disappear below.
          if (isOthers(staff, assignedToId)) {
            onChange({ assignedToId, bookedDate: todayIST(), bookedHalfDay: 'morning', location: 'home' });
          } else {
            onChange({ ...value, assignedToId });
          }
        }}
      >
        <option value="">Assign to...</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {!othersSelected && (
        <div className="flex gap-2">
          <input
            type="date"
            required
            className={`${fieldClass} flex-1`}
            value={value.bookedDate}
            onChange={(e) => onChange({ ...value, bookedDate: e.target.value })}
          />
          <select
            className={fieldClass}
            value={value.bookedHalfDay}
            onChange={(e) => onChange({ ...value, bookedHalfDay: e.target.value })}
          >
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
          {showLocation && (
            <select
              className={fieldClass}
              value={value.location}
              onChange={(e) => onChange({ ...value, location: e.target.value })}
            >
              <option value="home">Home</option>
              <option value="office">Office</option>
            </select>
          )}
        </div>
      )}
      {/* A workload/leave note only ever makes sense against a real
          date/technician — Others has neither. */}
      {!othersSelected && extra}
      {!othersSelected && isOnApprovedLeave(staff, value.assignedToId, value.bookedDate) && (
        <p className="text-xs text-warn">
          This person is on approved leave that day — you can still book them (§11.5).
        </p>
      )}
      <button
        disabled={submitting}
        className={
          compact
            ? 'w-full py-1.5 bg-accent text-white rounded text-sm hover:bg-accent-hover disabled:opacity-50'
            : 'px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50'
        }
      >
        {submitting ? (submittingLabel ?? submitLabel) : submitLabel}
      </button>
    </>
  );
}
