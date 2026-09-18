import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // Check for session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Redirect unauthenticated users to login (except public pages)
  if (!session && !request.nextUrl.pathname.startsWith('/auth/login')) {
    // Allow requests to static files, public API routes, and the public
    // quotation-sheet route (/q/[token]) — a customer opening a WhatsApp/
    // email link has no session and never will.
    if (
      !request.nextUrl.pathname.startsWith('/_next') &&
      !request.nextUrl.pathname.startsWith('/api/public') &&
      !request.nextUrl.pathname.startsWith('/q/')
    ) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/auth/login';
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Redirect authenticated users away from login page
  if (session && request.nextUrl.pathname.startsWith('/auth/login')) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    return NextResponse.redirect(redirectUrl);
  }

  // Every API response is live business data — never let a browser (or any
  // proxy in between) reuse an old copy of it. Found live 2026-09-18: a real
  // purchase (NASAR, 9072917796) was missing from /admin/orders on several
  // devices, each surviving a hard refresh, while the deployed server was
  // verifiably returning it correctly. These responses went out with no
  // Cache-Control header at all, which leaves a plain 200 eligible for
  // heuristic caching — and a hard reload doesn't reliably bypass that for a
  // fetch() fired later from JS. `export const dynamic = 'force-dynamic'`
  // (added to every GET route earlier the same day) only stops Next.js
  // caching the response on the server; it says nothing to the client.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/public (public API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api/public|_next/static|_next/image|favicon.ico).*)',
  ],
};
