import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Creates a Supabase client for use in Route Handlers / Server Components,
 * bound to the caller's session cookies so `auth.uid()` resolves correctly
 * and RLS policies apply as a second layer of defense behind the explicit
 * role checks in lib/api-auth.ts.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {
          // Route handlers can't set cookies on the incoming request;
          // session refresh is handled by middleware.
        },
        remove() {},
      },
    }
  );
}
