'use client';

import Link from 'next/link';

// "/" already redirects to the right place for whoever's signed in —
// /dashboard for admin/owner, straight to /staff/jobs for service staff
// (§15.2) — so Home never needs to know who's looking at it.
export default function HomeLink() {
  return (
    <Link href="/" className="text-sm text-blue-600 hover:underline whitespace-nowrap">
      ← Home
    </Link>
  );
}
