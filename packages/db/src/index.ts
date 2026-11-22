import pg from 'pg';
import type { DemoAction, DemoResult } from '@threads-id/contracts';

export * from './auth.js';
export * from './generation.js';
export * from './editorial.js';
export * from './drafts.js';
export * from './schedule.js';
export * from './threads.js';
export * from './trend.js';

const { Pool } = pg;
export type { DemoResult } from '@threads-id/contracts';

type ActionRow = {
  id: string; kind: 'SYNTHETIC_AGE_20S'; status: DemoAction['status']; demo: true;
  result: DemoResult | null; error: string | null; created_at: Date; updated_at: Date;
};

function mapAction(row: ActionRow): DemoAction {
  return {
    id: row.id, kind: row.kind, status: row.status, demo: true,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    result: row.result, error: row.error
  };
}

export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('DATABASE_URL wajib diisi');
  return new Pool({ connectionString });
}

export class ActionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(id: string): Promise<void> {
    await this.pool.query("INSERT INTO demo_actions (id, kind, status, demo) VALUES ($1, 'SYNTHETIC_AGE_20S', 'QUEUED', true) ON CONFLICT (id) DO NOTHING", [id]);
  }
  async get(id: string): Promise<DemoAction | null> {
    const result = await this.pool.query<ActionRow>('SELECT * FROM demo_actions WHERE id = $1', [id]);
    return result.rows[0] ? mapAction(result.rows[0]) : null;
  }
  async list(limit = 50): Promise<DemoAction[]> {
    const result = await this.pool.query<ActionRow>('SELECT * FROM demo_actions ORDER BY created_at DESC LIMIT $1', [limit]);
    return result.rows.map(mapAction);
  }
  async claim(id: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE demo_actions SET status = 'PROCESSING', updated_at = now() WHERE id = $1 AND status = 'QUEUED' RETURNING id", [id]);
    return result.rowCount === 1;
  }
  async complete(id: string, value: DemoResult): Promise<void> {
    await this.pool.query("UPDATE demo_actions SET status = 'COMPLETED', result = $2::jsonb, error = NULL, completed_at = now(), updated_at = now() WHERE id = $1 AND status = 'PROCESSING'", [id, JSON.stringify(value)]);
  }
  async fail(id: string, error: string): Promise<void> {
    await this.pool.query("UPDATE demo_actions SET status = 'FAILED', error = $2, updated_at = now() WHERE id = $1 AND status IN ('QUEUED','PROCESSING')", [id, error]);
  }
}
