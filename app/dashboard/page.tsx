'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/lib/auth';

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchUser = async () => {
      // Dynamically import to avoid build-time issues
      const { getCurrentUser, signOut } = await import('@/lib/auth');
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        router.push('/auth/login');
        return;
      }
      setUser(currentUser);
      setLoading(false);
    };

    fetchUser();
  }, [router]);

  const handleSignOut = async () => {
    const { signOut } = await import('@/lib/auth');
    await signOut();
    router.push('/auth/login');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                {user.name} ({user.role})
              </span>
              <button
                onClick={handleSignOut}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg h-96 p-4">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Welcome to Water Purifier Service System
            </h2>

            {user.role === 'admin' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-blue-900 mb-2">Admin Dashboard</h3>
                <p className="text-sm text-blue-800 mb-4">
                  Manage enquiries, book installations, and track payments
                </p>
                <nav className="space-y-2">
                  <a href="/admin/enquiries" className="block text-blue-600 hover:text-blue-900">
                    → View Enquiries
                  </a>
                  <a href="/admin/installations" className="block text-blue-600 hover:text-blue-900">
                    → View Installations
                  </a>
                  <a href="/admin/customers" className="block text-blue-600 hover:text-blue-900">
                    → View Customers
                  </a>
                </nav>
              </div>
            )}

            {user.role === 'owner' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-green-900 mb-2">Owner Dashboard</h3>
                <p className="text-sm text-green-800 mb-4">
                  View business overview, approvals, and reports
                </p>
                <nav className="space-y-2">
                  <a href="/owner/overview" className="block text-green-600 hover:text-green-900">
                    → Business Overview
                  </a>
                  <a href="/owner/payments" className="block text-green-600 hover:text-green-900">
                    → Outstanding Payments
                  </a>
                  <a href="/owner/approvals" className="block text-green-600 hover:text-green-900">
                    → Pending Approvals
                  </a>
                </nav>
              </div>
            )}

            {user.role === 'service_staff' && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-purple-900 mb-2">My Jobs</h3>
                <p className="text-sm text-purple-800 mb-4">
                  View and complete your assigned jobs
                </p>
                <nav className="space-y-2">
                  <a href="/staff/jobs" className="block text-purple-600 hover:text-purple-900">
                    → My Jobs
                  </a>
                  <a href="/staff/time-off" className="block text-purple-600 hover:text-purple-900">
                    → Request Time Off
                  </a>
                </nav>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
