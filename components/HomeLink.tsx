'use client';

import Link from 'next/link';

// "/" already redirects to /dashboard, which renders the right thing for
// whoever's signed in — so Home never needs to know who's looking at it.
export default function HomeLink() {
  return (
    <Link href="/" className="text-sm text-blue-600 hover:underline whitespace-nowrap">
      ← Home
    </Link>
  );
}
