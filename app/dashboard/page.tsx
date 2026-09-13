'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCurrentUser, type User } from '@/lib/auth';
import AppShell from '@/components/AppShell';
import AdminDashboard from '@/components/dashboard/AdminDashboard';
import OwnerDashboard from '@/components/dashboard/OwnerDashboard';

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-ink-2 text-[13px]">Loading…</div>}>
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

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen text-ink-2 text-[13px]">Loading…</div>
    );
  }

  return (
    <AppShell title="Today">
      {user.role === 'admin' ? (
        <AdminDashboard />
      ) : user.role === 'owner' ? (
        <OwnerDashboard />
      ) : (
        // service_staff — see CLAUDE.md's staff-portal-removal note.
        // Jobs are assigned and reported over Telegram now; this
        // account has nothing to do in the app itself any more.
        <p className="text-ink-2 text-[14px]">
          There&apos;s nothing here for this account any more — job assignments now come through the Telegram group.
        </p>
      )}
    </AppShell>
  );
}
