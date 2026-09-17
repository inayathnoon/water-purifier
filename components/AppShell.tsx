'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getCurrentUser, signOut, type User, type UserRole } from '@/lib/auth';

// One nav array, role-filtered, used by the sidebar on every authenticated
// page — this replaces the hand-rolled button grids each dashboard used
// to draw for itself, and gives every /admin/* and /owner/* page the
// current-section indicator neither had before.
interface NavItem {
  href: string;
  label: string;
  roles: UserRole[];
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Today', roles: ['admin', 'owner'] },
  { href: '/admin/enquiries', label: 'Enquiries', roles: ['admin', 'owner'] },
  { href: '/admin/orders', label: 'Purchases', roles: ['admin', 'owner'] },
  { href: '/admin/installations', label: 'Installations', roles: ['admin'] },
  { href: '/admin/service-calls', label: 'Services', roles: ['admin', 'owner'] },
  { href: '/admin/spare-parts', label: 'Spares', roles: ['admin'] },
  { href: '/admin/customers', label: 'Customers', roles: ['admin', 'owner'] },
  { href: '/admin/products', label: 'Products', roles: ['admin', 'owner'] },
  { href: '/admin/quotations', label: 'Quotations', roles: ['admin', 'owner'] },
  { href: '/admin/leave', label: 'Time off', roles: ['admin'] },
  { href: '/owner/leave', label: 'Time off', roles: ['owner'] },
];

const NEW_MENU = [
  { href: '/admin/quotations?new=1', label: 'New quotation' },
  { href: '/admin/enquiries?new=1', label: 'New enquiry' },
  { href: '/admin/installations?new=1', label: 'New purchase' },
  { href: '/admin/service-calls?new=1', label: 'New service' },
  { href: '/admin/spare-parts?new=1', label: 'Sell spares' },
];

export default function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-ink-2 text-[13px]">Loading…</div>}>
      <ShellInner title={title}>{children}</ShellInner>
    </Suspense>
  );
}

function ShellInner({ title, children }: { title: string; children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get('viewAs');

  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((u) => {
      if (cancelled) return;
      if (!u) {
        router.push('/auth/login');
        return;
      }
      if (u.role === 'developer' && (viewAs === 'admin' || viewAs === 'owner')) {
        setUser({ ...u, role: viewAs });
        setLoading(false);
        return;
      }
      if (u.role === 'developer') {
        router.replace('/developer');
        return;
      }
      setUser(u);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router, viewAs]);

  useEffect(() => {
    if (!newMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setNewMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNewMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [newMenuOpen]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth/login');
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen text-ink-2 text-[13px]">Loading…</div>
    );
  }

  const items = NAV.filter((n) => n.roles.includes(user.role as UserRole));

  const sidebar = (
    <nav className="flex flex-col h-full">
      <div className="h-14 flex items-center px-5 border-b border-rule shrink-0">
        <span className="font-condensed text-[17px] uppercase tracking-[0.04em]">Noon Enterprises</span>
      </div>
      <ul className="flex-1 overflow-y-auto py-2">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setMobileNavOpen(false)}
                className={`block px-5 py-2.5 text-[14px] border-l-2 ${
                  active
                    ? 'border-l-accent text-accent-deep font-semibold bg-accent-tint'
                    : 'border-l-transparent text-ink-2 hover:bg-inset hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <div className="min-h-screen flex">
      {/* Developer "View as" preview strip — same behavior as before, restyled. */}
      {viewAs && (
        <div className="fixed top-0 inset-x-0 z-40 bg-warn-tint text-warn border-b border-rule text-[13px] text-center py-1.5">
          Previewing as {viewAs} —{' '}
          <Link href="/developer" className="underline font-semibold">
            back to Developer panel
          </Link>
        </div>
      )}

      {/* Sidebar — persistent ≥1024px, hidden (hamburger sheet) below that. */}
      <aside className={`hidden lg:block w-[var(--sidebar-w)] shrink-0 border-r border-rule bg-surface ${viewAs ? 'mt-8' : ''}`}>
        <div className="fixed w-[var(--sidebar-w)] h-screen">{sidebar}</div>
      </aside>

      {/* Mobile nav sheet */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-[260px] bg-surface border-r border-rule h-full">{sidebar}</div>
          <button
            aria-label="Close menu"
            className="flex-1 bg-ink/40"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      <div className={`flex-1 min-w-0 flex flex-col ${viewAs ? 'mt-8' : ''}`}>
        {/* Top bar */}
        <header className="h-14 shrink-0 border-b border-rule bg-surface sticky top-0 z-30 flex items-center gap-3 px-4 lg:px-8">
          <button
            className="lg:hidden shrink-0 w-9 h-9 flex items-center justify-center border border-rule focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-label="Open menu"
            onClick={() => setMobileNavOpen(true)}
          >
            <span aria-hidden>☰</span>
          </button>
          <h1 className="font-condensed text-[22px] leading-none truncate flex-1 min-w-0">{title}</h1>

          {user.role === 'admin' && (
            <div className="relative shrink-0" ref={menuRef}>
              <button
                onClick={() => setNewMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={newMenuOpen}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                New ▾
              </button>
              {newMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1 w-48 bg-surface border border-rule shadow-md z-40"
                >
                  {NEW_MENU.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      role="menuitem"
                      onClick={() => setNewMenuOpen(false)}
                      className="block px-4 py-2.5 text-[13px] text-ink hover:bg-accent-tint focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
                    >
                      {n.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="hidden sm:flex items-center gap-2 shrink-0 pl-3 ml-1 border-l border-rule">
            <span className="text-[13px]">
              {user.name} <span className="text-ink-2">({user.role})</span>
            </span>
          </div>
          <button
            onClick={handleSignOut}
            className="shrink-0 px-3 py-1.5 text-[13px] text-ink border border-rule hover:bg-accent-tint focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Sign out
          </button>
        </header>

        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 lg:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
