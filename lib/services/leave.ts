import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import { notifyLeaveRequested, notifyLeaveDecided } from './notifications';

/** §11.1: a technician requests leave, giving dates and a reason. */
export async function requestLeave(requesterId: string, startDate: string, endDate: string, reason: string) {
  if (!reason.trim()) throw new ApiError(400, 'A reason is required');
  if (new Date(endDate) < new Date(startDate)) throw new ApiError(400, 'End date must be on or after start date');

  const { data, error } = await supabaseAdmin
    .from('leave_requests')
    .insert({ requester_id: requesterId, start_date: startDate, end_date: endDate, reason })
    .select('*, users:requester_id(name)')
    .single();

  if (error) throw new ApiError(500, error.message);

  // §11.2: posted to the group so an owner sees it, then waits.
  // Fire-and-forget — a Telegram send shouldn't hold up the response.
  notifyLeaveRequested({
    requesterName: data.users?.name ?? 'Unknown',
    startDate,
    endDate,
    reason,
  }).catch(() => {});

  return data;
}

/**
 * §11.3: only an owner decides — the caller's role is checked in the API
 * route, not here, but this function is never wired to any admin route,
 * so there's exactly one path that can reach it.
 * §11.4: refusing requires a reason — the DB trigger enforces this too.
 */
export async function decideLeave(
  requestId: string,
  decidedBy: string,
  decision: 'approved' | 'denied',
  reason?: string
) {
  if (decision === 'denied' && !reason?.trim()) {
    throw new ApiError(400, 'Refusing leave requires a reason');
  }

  const { data: existing, error: findError } = await supabaseAdmin
    .from('leave_requests')
    .select('status')
    .eq('id', requestId)
    .single();
  if (findError || !existing) throw new ApiError(404, 'Leave request not found');
  if (existing.status !== 'pending') throw new ApiError(400, 'This request has already been decided');

  const { data, error } = await supabaseAdmin
    .from('leave_requests')
    .update({
      status: decision,
      decided_by: decidedBy,
      decision_reason: reason ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select('*, users:requester_id(name)')
    .single();

  if (error) throw new ApiError(500, error.message);

  // §10.5: fired only after the status change above has committed — the
  // one notification the requester actually cares about, previously the
  // only silent step in the whole leave flow. Fire-and-forget.
  (async () => {
    const { data: decider } = await supabaseAdmin.from('users').select('name').eq('id', decidedBy).single();
    await notifyLeaveDecided({
      requesterName: data.users?.name ?? 'Unknown',
      decision,
      startDate: data.start_date,
      endDate: data.end_date,
      decidedByName: decider?.name ?? 'Unknown',
      reason: data.decision_reason,
    });
  })().catch(() => {});

  return data;
}

/**
 * §11.5: approved leave shows on the booking calendar but never blocks a
 * booking — this is read-only context for the admin, not an enforcement.
 */
export async function getApprovedLeaveByStaff(): Promise<Record<string, { start_date: string; end_date: string }[]>> {
  const { data, error } = await supabaseAdmin
    .from('leave_requests')
    .select('requester_id, start_date, end_date')
    .eq('status', 'approved')
    .gte('end_date', new Date().toISOString().slice(0, 10)); // only future/current relevance

  if (error) throw new ApiError(500, error.message);

  const byStaff: Record<string, { start_date: string; end_date: string }[]> = {};
  for (const row of data ?? []) {
    (byStaff[row.requester_id] ??= []).push({ start_date: row.start_date, end_date: row.end_date });
  }
  return byStaff;
}
