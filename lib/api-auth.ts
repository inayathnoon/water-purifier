import { createServerSupabaseClient } from './supabase-server';
import type { UserRole, User } from './auth';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves the calling user from their session cookie and checks their role.
 * Every mutating API route calls this first — this is the one place role
 * checks live, so a rule like "jobs only go to service staff" (§13.5) can't
 * be bypassed by a route that forgets to check.
 *
 * Throws ApiError(401) if not signed in, ApiError(403) if signed in but the
 * wrong role for this action.
 */
export async function requireUser(allowedRoles?: UserRole[]): Promise<User> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    throw new ApiError(401, 'Not signed in');
  }

  const { data: profile, error } = await supabase
    .from('users')
    .select('id, email, role, name')
    .eq('id', authUser.id)
    .single();

  if (error || !profile) {
    throw new ApiError(401, 'No user profile found');
  }

  const user = profile as User;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new ApiError(403, `This action requires role: ${allowedRoles.join(' or ')}`);
  }

  return user;
}

/** Wraps a route handler body, turning ApiError into the right HTTP response. */
export function handleApiError(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error('Unhandled API error:', err);
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}
