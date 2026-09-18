'use client';

import { useEffect, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';

// Deep-link target from Telegram messages (§10.4). Middleware already
// requires a session to reach this page at all; this just figures out
// where "the job" actually lives for this viewer's role and sends them
// there — admin/owner to the right screen (a service_staff account has
// no page of its own any more, see CLAUDE.md's staff-portal-removal note).
export default function TicketRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tickets/${id}/redirect-target`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        router.replace(data.target ?? '/dashboard');
      })
      .catch(() => {
        if (!cancelled) router.replace('/dashboard');
      });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gray-900">Opening...</p>
    </div>
  );
}
