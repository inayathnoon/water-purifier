'use client';

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

  return (
    <>
      <select
        required
        className={`${fieldClass} w-full`}
        value={value.assignedToId}
        onChange={(e) => onChange({ ...value, assignedToId: e.target.value })}
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
      {extra}
      {isOnApprovedLeave(staff, value.assignedToId, value.bookedDate) && (
        <p className="text-xs text-orange-600">
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
