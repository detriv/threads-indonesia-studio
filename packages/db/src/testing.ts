import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { applyMigrations } from './migrate.js';

const { Pool } = pg;

function readDotEnv(): Record<string, string> {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const text = readFileSync(resolve(root, '.env'), 'utf8');
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      out[trimmed.slice(0, trimmed.indexOf('='))] = trimmed.slice(trimmed.indexOf('=') + 1);
    }
    return out;
  } catch {
    return {};
  }
}

function defaultTestUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const env = { ...readDotEnv(), ...process.env };
  const user = env.POSTGRES_USER ?? 'threads';
  const password = env.POSTGRES_PASSWORD ?? 'threads_local_only';
  const db = env.POSTGRES_DB ?? 'threads_id';
  return `postgres://${user}:${password}@127.0.0.1:5432/${db}_test`;
}

export const TEST_DATABASE_URL = defaultTestUrl();

/** Buat ulang database test terpisah (bukan database demo), lalu terapkan migrasi. */
export async function resetTestDatabase(url = TEST_DATABASE_URL): Promise<pg.Pool> {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error('resetTestDatabase hanya boleh menarget database berakhiran _test');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString() });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: url });
  await applyMigrations(pool);
  return pool;
}

const TABLES = [
  'publish_attempts', 'publish_queue', 'threads_connection',
  'generation_attempts', 'generation_requests',
  'schedule_executions', 'schedule_outbox', 'schedule_entries', 'drafts',
  'review_topics', 'personal_sources', 'voice_examples', 'theme_examples', 'themes',
  'editorial_settings', 'admin_sessions', 'admin_users', 'demo_actions',
  'trend_candidates', 'trend_items', 'trend_runs', 'trend_settings',
  'reply_attempts', 'reply_queue', 'reply_settings',
  'reply_inbox', 'reply_runs'
];

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
}
