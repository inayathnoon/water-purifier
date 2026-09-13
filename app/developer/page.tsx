'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, signOut, type User, type UserRole } from '@/lib/auth';

interface StaffRow {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

interface MigrationRow {
  filename: string;
  applied: boolean;
  appliedAt: string | null;
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
// Same spreadsheet, the "Spare Parts" tab specifically (gid points straight at it).
const SPARE_PARTS_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1xRbDhklv0v10Tpl2BgdI9QnU2H8KQJ0NCHD21JKUBO4/edit?gid=1620923747#gid=1620923747';
// Same spreadsheet, the "Areas" tab — the area suggestions every
// AreaSelect autocomplete across the app reads from a shared list.
const AREAS_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1xRbDhklv0v10Tpl2BgdI9QnU2H8KQJ0NCHD21JKUBO4/edit?gid=1002871651#gid=1002871651';

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
  const [areasSyncing, setAreasSyncing] = useState(false);
  const [areasSyncMessage, setAreasSyncMessage] = useState('');
  const [migrations, setMigrations] = useState<MigrationRow[]>([]);
  const [migrationsLoading, setMigrationsLoading] = useState(true);
  const [runningMigrations, setRunningMigrations] = useState(false);
  const [migrationResult, setMigrationResult] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/developer/staff');
    const data = await res.json();
    setStaff(data.staff ?? []);
    setLoading(false);
  };

  const loadMigrations = async () => {
    setMigrationsLoading(true);
    const res = await fetch('/api/developer/migrations');
    const data = await res.json();
    setMigrations(data.migrations ?? []);
    setMigrationsLoading(false);
  };

  useEffect(() => {
    getCurrentUser().then(setUser);
    load();
    loadMigrations();
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth/login');
  };

  const handleRunMigrations = async () => {
    setMigrationResult('');
    setRunningMigrations(true);
    const res = await fetch('/api/developer/migrations/run', { method: 'POST' });
    const data = await res.json();
    setRunningMigrations(false);
    if (!res.ok) {
      setMigrationResult(data.error ?? 'Failed to run migrations');
    } else if (data.failed) {
      setMigrationResult(`Ran ${data.ran.length}, then ${data.failed.filename} failed: ${data.failed.error}`);
    } else {
      setMigrationResult(data.ran.length > 0 ? `Applied: ${data.ran.join(', ')}` : 'Already up to date.');
    }
    loadMigrations();
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

  // Same cached-in-memory pattern as spare parts — the area suggestions
  // barely change, so this forces an immediate refresh instead of
  // waiting on the cache's long safety-net TTL.
  const handleSyncAreas = async () => {
    setAreasSyncMessage('');
    setAreasSyncing(true);
    const res = await fetch('/api/developer/areas/sync', { method: 'POST' });
    const data = await res.json();
    setAreasSyncing(false);
    setAreasSyncMessage(res.ok ? `Synced: ${data.areas?.length ?? 0} areas loaded.` : data.error ?? 'Sync failed');
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex justify-between items-center gap-2 mb-6">
        <span className="text-sm text-ink-2">{user?.name} (developer)</span>
        <button
          onClick={handleSignOut}
          className="px-3 py-1.5 text-sm text-ink bg-surface border border-rule rounded-md hover:bg-accent-tint"
        >
          Sign out
        </button>
      </div>

      <h1 className="text-2xl font-bold mb-1">Developer Panel</h1>
      <p className="text-sm text-ink-2 mb-6">Maintenance tools — not part of the business dashboard.</p>

      {error && <p className="text-danger bg-danger-tint p-3 rounded mb-4 text-sm">{error}</p>}

      <div className="bg-surface rounded-lg shadow-sm border border-rule p-4 mb-6">
        <h2 className="font-semibold mb-1">View As</h2>
        <p className="text-sm text-ink-2 mb-3">
          Preview what each role actually sees — read-only, doesn't need a separate account.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard?viewAs=admin" className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent-tint">
            View as Admin
          </Link>
          <Link href="/dashboard?viewAs=owner" className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent-tint">
            View as Owner
          </Link>
        </div>
      </div>

      <div className="bg-surface rounded-lg shadow-sm border border-rule p-4 mb-6">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-semibold">Database Migrations</h2>
          {!migrationsLoading && migrations.filter((m) => !m.applied).length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-800">
              {migrations.filter((m) => !m.applied).length} pending
            </span>
          )}
        </div>
        {migrationsLoading ? (
          <p className="text-sm text-ink-2">Loading...</p>
        ) : (
          <>
            <div className="divide-y mb-3 max-h-48 overflow-y-auto">
              {migrations.map((m) => (
                <div key={m.filename} className="flex justify-between items-center py-1.5 text-sm">
                  <span className={m.applied ? 'text-ink' : 'font-medium'}>{m.filename}</span>
                  <span className={m.applied ? 'text-ok' : 'text-orange-700'}>
                    {m.applied ? 'Applied' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRunMigrations}
                disabled={runningMigrations || migrations.every((m) => m.applied)}
                className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover disabled:opacity-50"
              >
                {runningMigrations ? 'Running...' : 'Run Pending Migrations'}
              </button>
              {migrationResult && <span className="text-sm text-ink-2">{migrationResult}</span>}
            </div>
          </>
        )}
      </div>

      <div className="bg-surface rounded-lg shadow-sm border border-rule p-4 mb-6">
        <h2 className="font-semibold mb-1">Product / Spare Parts / Areas Sheet</h2>
        <p className="text-sm text-ink-2 mb-3">
          The sheet is the source of truth (§9) — add or edit rows there directly, then sync.
        </p>

        <div className="space-y-3">
          <div className="bg-inset rounded-lg p-3">
            <p className="text-xs font-medium text-ink uppercase tracking-wide mb-2">Product Catalog</p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={PRODUCT_SHEET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover"
              >
                Open Sheet →
              </a>
              <button
                onClick={handleSyncProducts}
                disabled={syncing}
                className="px-3 py-1.5 bg-surface border rounded-md text-sm hover:bg-inset disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync products now'}
              </button>
              {syncMessage && <span className="text-sm text-ink-2">{syncMessage}</span>}
            </div>
          </div>

          <div className="bg-inset rounded-lg p-3">
            <p className="text-xs font-medium text-ink uppercase tracking-wide mb-2">Spare Parts</p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={SPARE_PARTS_SHEET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover"
              >
                Open Spare Parts Sheet →
              </a>
              <button
                onClick={handleSyncSpareParts}
                disabled={sparePartsSyncing}
                className="px-3 py-1.5 bg-surface border rounded-md text-sm hover:bg-inset disabled:opacity-50"
              >
                {sparePartsSyncing ? 'Syncing...' : 'Sync spare parts'}
              </button>
              {sparePartsSyncMessage && <span className="text-sm text-ink-2">{sparePartsSyncMessage}</span>}
            </div>
          </div>

          <div className="bg-inset rounded-lg p-3">
            <p className="text-xs font-medium text-ink uppercase tracking-wide mb-2">Areas</p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={AREAS_SHEET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent-hover"
              >
                Open Areas Sheet →
              </a>
              <button
                onClick={handleSyncAreas}
                disabled={areasSyncing}
                className="px-3 py-1.5 bg-surface border rounded-md text-sm hover:bg-inset disabled:opacity-50"
              >
                {areasSyncing ? 'Syncing...' : 'Sync areas'}
              </button>
              {areasSyncMessage && <span className="text-sm text-ink-2">{areasSyncMessage}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface rounded-lg shadow-sm border border-rule p-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Staff Accounts</h2>
          <button
            onClick={() => setShowAddForm((s) => !s)}
            className="px-3 py-1.5 bg-ok hover:opacity-90 text-white text-sm"
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
              className="w-full py-2 bg-ok hover:opacity-90 text-white text-sm disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create account'}
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-ink-2">Loading...</p>
        ) : (
          <div className="divide-y">
            {staff.map((member) => (
              <div key={member.id} className="py-2 flex justify-between items-center gap-2">
                <div>
                  <p className={`text-sm font-medium ${!member.active ? 'text-ink-3 line-through' : ''}`}>
                    {member.name}
                  </p>
                  <p className="text-xs text-ink-2">
                    {member.phone} · {ROLE_LABEL[member.role]}
                    {!member.active && ' · deactivated'}
                  </p>
                </div>
                <button
                  onClick={() => handleToggleActive(member)}
                  className={`px-3 py-1.5 rounded-md text-xs whitespace-nowrap ${
                    member.active ? 'border hover:bg-accent-tint' : 'bg-accent text-white hover:bg-accent-hover'
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
