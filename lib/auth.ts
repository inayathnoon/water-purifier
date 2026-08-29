import { supabase } from './db';

export type UserRole = 'owner' | 'admin' | 'service_staff';

export interface User {
  id: string;
  email: string;
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
    .select('id, email, role, name')
    .eq('id', authUser.id)
    .single();

  if (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }

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
 * Sign in with email and password.
 */
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
}
