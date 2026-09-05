import { supabase } from './db';

export type UserRole = 'owner' | 'admin' | 'service_staff' | 'developer';

export interface User {
  id: string;
  phone: string;
  role: UserRole;
  name: string;
}

/**
 * Get the current authenticated user from the browser session.
 * Client-side only — use in React components and client endpoints.
 */
export async function getCurrentUser(): Promise<User | null> {
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  // Fetch user metadata (role, name) from the profiles table
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, role, name, active')
    .eq('id', authUser.id)
    .single();

  if (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }

  // A deactivated staff account (see the Developer panel) shouldn't be
  // treated as signed in anywhere in the app, even with a still-valid
  // session cookie.
  if (!data.active) return null;

  return data as User;
}

/**
 * Check if the current user has one of the allowed roles.
 */
export async function hasRole(allowedRoles: UserRole[]): Promise<boolean> {
  const user = await getCurrentUser();
  return user ? allowedRoles.includes(user.role) : false;
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Every account was created with an E.164 phone (+91XXXXXXXXXX, see
 * Supabase Auth), but nobody types a country code to log in — they type
 * the 10-digit number they know. Without this, "8157906367" and
 * "+918157906367" are different identities to Supabase and login just
 * fails with an opaque "Invalid login credentials".
 */
function toE164India(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digitsOnly = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  return `+91${digitsOnly}`;
}

/**
 * Sign in with phone number and password. No OTP/SMS involved — this is
 * Supabase's phone+password grant, so it's free and works offline of any
 * SMS provider.
 */
export async function signIn(phone: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    phone: toE164India(phone),
    password,
  });

  if (error) throw error;
}
