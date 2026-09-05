import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';
import type { UserRole } from '../auth';

// Same phone-normalization used at login (lib/auth.ts's toE164India) —
// every account is stored E.164, but nobody types a country code.
function toE164India(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digitsOnly = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  return `+91${digitsOnly}`;
}

export async function listStaff() {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, name, phone, role, active, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return data;
}

/**
 * Same method used for every account since Stage 1 — Supabase's Admin
 * API, not a SQL script, since auth.users and public.users both need a
 * row with the same id. Password defaults to the phone number itself,
 * matching the convention every existing staff account already uses.
 */
export async function createStaffMember(input: { name: string; phone: string; role: UserRole }) {
  if (!input.name.trim()) throw new ApiError(400, 'Name is required');
  if (!input.phone.trim()) throw new ApiError(400, 'A phone number is required');

  const phone = toE164India(input.phone);
  const password = input.phone.trim().replace(/\D/g, '');
  if (password.length < 6) throw new ApiError(400, 'Phone number is too short to use as the login password');

  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    phone,
    password,
    phone_confirm: true,
  });
  if (authError) throw new ApiError(400, authError.message);

  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({ id: authUser.user!.id, phone, name: input.name.trim(), role: input.role })
    .select('*')
    .single();
  if (error) {
    // Don't leave an orphaned login nobody can see or reach if the
    // profile row fails to insert (e.g. a role the DB doesn't accept).
    await supabaseAdmin.auth.admin.deleteUser(authUser.user!.id);
    throw new ApiError(500, error.message);
  }
  return data;
}

/** Retires an account without deleting it — their tickets/orders/leave
 * history stays attached to a real user row, and Auth login is blocked
 * via the `active` check in requireUser()/getCurrentUser(), not by
 * touching Supabase Auth itself. */
export async function deactivateStaffMember(id: string) {
  const { data, error } = await supabaseAdmin.from('users').update({ active: false }).eq('id', id).select('*').single();
  if (error) throw new ApiError(500, error.message);
  return data;
}

export async function reactivateStaffMember(id: string) {
  const { data, error } = await supabaseAdmin.from('users').update({ active: true }).eq('id', id).select('*').single();
  if (error) throw new ApiError(500, error.message);
  return data;
}
