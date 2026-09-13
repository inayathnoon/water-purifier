'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, signOut, type User } from '@/lib/auth';
import AdminDashboard from '@/components/dashboard/AdminDashboard';
import OwnerDashboard from '@/components/dashboard/OwnerDashboard';

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p>Loading...</p></div>}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  // The Developer panel's "View As" links land here with ?viewAs=admin or
  // ?viewAs=owner — lets the app's own maintainer preview those dashboards
  // without actually having an admin/owner account. Ignored for anyone
  // whose real role isn't 'developer', so it can't be used to escalate.
  const viewAs = searchParams.get('viewAs');

  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((currentUser) => {
      if (cancelled) return;
      if (!currentUser) {
        router.push('/auth/login');
        return;
      }
      // The app's own developer/maintainer sees a maintenance panel, not
      // the business dashboard — a separate account/page from 'owner' —
      // unless they've explicitly asked to preview one (see viewAs above).
      if (currentUser.role === 'developer' && (viewAs === 'admin' || viewAs === 'owner')) {
        setUser({ ...currentUser, role: viewAs });
        setLoading(false);
        return;
      }
      if (currentUser.role === 'developer') {
        router.replace('/developer');
        return;
      }
      setUser(currentUser);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router, viewAs]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth/login');
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {viewAs && (
        <div className="bg-yellow-50 border-b border-yellow-200 text-yellow-900 text-sm text-center py-2">
          Previewing as {viewAs} —{' '}
          <Link href="/developer" className="underline font-medium">
            back to Developer panel
          </Link>
        </div>
      )}
      <header className="bg-white shadow">
        <div className="max-w-6xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900">Noon Enterprises</h1>
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="text-sm text-gray-500">
              {user.name} ({user.role})
            </span>
            <button
              onClick={handleSignOut}
              className="px-3 py-1.5 text-sm text-gray-900 bg-white border border-gray-300 rounded-md hover:bg-gray-50 shrink-0"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {user.role === 'admin' ? (
          <AdminDashboard />
        ) : user.role === 'owner' ? (
          <OwnerDashboard />
        ) : (
          // service_staff — see CLAUDE.md's staff-portal-removal note.
          // Jobs are assigned and reported over Telegram now; this
          // account has nothing to do in the app itself any more.
          <p className="text-gray-500">
            There&apos;s nothing here for this account any more — job assignments now come through the Telegram group.
          </p>
        )}
      </main>
    </div>
  );
}
