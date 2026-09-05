import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../db';
import { ApiError } from '../api-auth';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

export interface MigrationStatus {
  filename: string;
  applied: boolean;
  appliedAt: string | null;
}

function listMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function getAppliedMigrations(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin.from('schema_migrations').select('filename, applied_at');
  if (error) throw new ApiError(500, `Could not read schema_migrations: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.filename, r.applied_at]));
}

export async function listMigrationStatus(): Promise<MigrationStatus[]> {
  const files = listMigrationFiles();
  const applied = await getAppliedMigrations();
  return files.map((filename) => ({
    filename,
    applied: applied.has(filename),
    appliedAt: applied.get(filename) ?? null,
  }));
}

/**
 * Runs every not-yet-applied migration file, in filename order, via the
 * exec_sql() RPC (bootstrapped once by hand — see CLAUDE.md). Deliberately
 * only ever runs the fixed contents of a committed migration file, never
 * free-typed SQL from the browser — this is "replay the next reviewed
 * migration", not a general SQL console. Stops at the first failure
 * rather than skipping ahead, since later migrations may depend on it.
 */
export async function runPendingMigrations(): Promise<{ ran: string[]; failed: { filename: string; error: string } | null }> {
  const status = await listMigrationStatus();
  const pending = status.filter((m) => !m.applied).map((m) => m.filename);

  const ran: string[] = [];
  for (const filename of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');
    const { error: execError } = await supabaseAdmin.rpc('exec_sql', { sql });
    if (execError) {
      return { ran, failed: { filename, error: execError.message } };
    }
    const { error: recordError } = await supabaseAdmin.from('schema_migrations').insert({ filename });
    if (recordError) {
      return { ran, failed: { filename, error: `Ran but failed to record: ${recordError.message}` } };
    }
    ran.push(filename);
  }
  return { ran, failed: null };
}
