'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, signOut, type User, type UserRole } from '@/lib/auth';

interface StaffRow {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  service_staff: 'Service Staff',
  developer: 'Developer',
};

// Where spare parts / the product catalog actually live — the sheet is
// the source of truth (§9), the app only ever syncs from it.
const PRODUCT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1xRbDhklv0v10Tpl2BgdI9QnU2H8KQJ0NCHD21JKUBO4/edit';

const emptyNewStaff = { name: '', phone: '', role: 'service_staff' as UserRole };

export default function DeveloperPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStaff, setNewStaff] = useState(emptyNewStaff);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [sparePartsSyncing, setSparePartsSyncing] = useState(false);
  const [sparePartsSyncMessage, setSparePartsSyncMessage] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/developer/staff');
    const data = await res.json();
    setStaff(data.staff ?? []);
    setLoading(false);
  };

  useEffect(() => {
    getCurrentUser().then(setUser);
    load();
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth/login');
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    const res = await fetch('/api/developer/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newStaff),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? 'Failed to create account');
      return;
    }
    setNewStaff(emptyNewStaff);
    setShowAddForm(false);
    load();
  };

  const handleToggleActive = async (member: StaffRow) => {
    setError('');
    const action = member.active ? 'deactivate' : 'reactivate';
    const res = await fetch(`/api/developer/staff/${member.id}/${action}`, { method: 'POST' });
    if (!res.ok) {
      setError((await res.json()).error ?? `Failed to ${action}`);
      return;
    }
    load();
  };

  const handleSyncProducts = async () => {
    setSyncMessage('');
    setSyncing(true);
    const res = await fetch('/api/admin/products/sync-now', { method: 'POST' });
    const data = await res.json();
    setSyncing(false);
    setSyncMessage(res.ok ? `Synced: ${data.upserted ?? 0} products updated.` : data.error ?? 'Sync failed');
  };

  // Spare parts are cached in memory (they barely ever change) rather
  // than synced into the DB — this forces an immediate refresh instead
  // of waiting on the cache's long safety-net TTL.
  const handleSyncSpareParts = async () => {
    setSparePartsSyncMessage('');
    setSparePartsSyncing(true);
    const res = await fetch('/api/developer/spare-parts/sync', { method: 'POST' });
    const data = await res.json();
    setSparePartsSyncing(false);
    setSparePartsSyncMessage(res.ok ? `Synced: ${data.parts?.length ?? 0} spare parts loaded.` : data.error ?? 'Sync failed');
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex justify-between items-center gap-2 mb-6">
        <span className="text-sm text-gray-900">{user?.name} (developer)</span>
        <button
          onClick={handleSignOut}
          className="px-3 py-1.5 text-sm text-gray-900 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>

      <h1 className="text-2xl font-bold mb-1">Developer Panel</h1>
      <p className="text-sm text-gray-900 mb-6">Maintenance tools — not part of the business dashboard.</p>

      {error && <p className="text-red-600 bg-red-50 p-3 rounded mb-4 text-sm">{error}</p>}

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="font-semibold mb-2">Product / Spare Parts Sheet</h2>
        <p className="text-sm text-gray-900 mb-3">
          The sheet is the source of truth for the product catalog (§9) — add or edit rows there directly, then
          sync.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={PRODUCT_SHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
          >
            Open Sheet →
          </a>
          <button
            onClick={handleSyncProducts}
            disabled={syncing}
            className="px-3 py-1.5 border rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync products now'}
          </button>
          {syncMessage && <span className="text-sm text-gray-900">{syncMessage}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t">
          <button
            onClick={handleSyncSpareParts}
            disabled={sparePartsSyncing}
            className="px-3 py-1.5 border rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {sparePartsSyncing ? 'Syncing...' : 'Sync spare parts'}
          </button>
          {sparePartsSyncMessage && <span className="text-sm text-gray-900">{sparePartsSyncMessage}</span>}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Staff Accounts</h2>
          <button
            onClick={() => setShowAddForm((s) => !s)}
            className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
          >
            {showAddForm ? 'Cancel' : '+ Add Staff'}
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddStaff} className="border rounded-lg p-3 mb-4 space-y-2">
            <input
              required
              placeholder="Name"
              className="w-full border rounded px-3 py-2 text-sm"
              value={newStaff.name}
              onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
            />
            <input
              required
              placeholder="Phone number (10 digits) — this is also their login password"
              className="w-full border rounded px-3 py-2 text-sm"
              value={newStaff.phone}
              onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value })}
            />
            <select
              className="w-full border rounded px-3 py-2 text-sm"
              value={newStaff.role}
              onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value as UserRole })}
            >
              <option value="service_staff">Service Staff</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
              <option value="developer">Developer</option>
            </select>
            <button
              disabled={submitting}
              className="w-full py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create account'}
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-gray-900">Loading...</p>
        ) : (
          <div className="divide-y">
            {staff.map((member) => (
              <div key={member.id} className="py-2 flex justify-between items-center gap-2">
                <div>
                  <p className={`text-sm font-medium ${!member.active ? 'text-gray-400 line-through' : ''}`}>
                    {member.name}
                  </p>
                  <p className="text-xs text-gray-900">
                    {member.phone} · {ROLE_LABEL[member.role]}
                    {!member.active && ' · deactivated'}
                  </p>
                </div>
                <button
                  onClick={() => handleToggleActive(member)}
                  className={`px-3 py-1.5 rounded-md text-xs whitespace-nowrap ${
                    member.active ? 'border hover:bg-gray-50' : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {member.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
