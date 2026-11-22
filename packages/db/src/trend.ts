import type { Pool } from 'pg';
import type { TrendCandidate, TrendItem, TrendSettings, TrendSource } from '@threads-id/contracts';
import { DEFAULT_TREND_SETTINGS } from '@threads-id/contracts';

type ItemRow = {
  id: string; source: string; source_name: string; title: string; url: string;
  summary: string | null; published_at: Date | null; categories: string[];
  raw: unknown; fetched_at: Date;
};

type CandidateRow = {
  id: string; trend_item_id: string; draft_id: string | null; score: number; threshold: number;
  reasons: TrendCandidate['reasons']; status: TrendCandidate['status'];
  created_at: Date; updated_at: Date;
  title: string; url: string; source_name: string; published_at: Date | null;
};

type SettingsRow = {
  enabled: boolean; paused: boolean; threshold: number; daily_limit: number; sources: TrendSource[];
};

function mapItem(row: ItemRow): TrendItem {
  return {
    id: row.id, source: row.source, sourceName: row.source_name, title: row.title, url: row.url,
    summary: row.summary,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    categories: row.categories ?? [], raw: row.raw,
    fetchedAt: row.fetched_at.toISOString()
  };
}

function mapCandidate(row: CandidateRow): TrendCandidate {
  return {
    id: row.id, itemId: row.trend_item_id, draftId: row.draft_id, score: row.score, threshold: row.threshold,
    reasons: row.reasons ?? [], status: row.status,
    title: row.title, url: row.url, sourceName: row.source_name,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
  };
}

function mapSettings(row: SettingsRow): TrendSettings {
  return {
    enabled: row.enabled, paused: row.paused, threshold: row.threshold,
    dailyLimit: row.daily_limit,
    sources: Array.isArray(row.sources) && row.sources.length > 0 ? row.sources : DEFAULT_TREND_SETTINGS.sources
  };
}

export class TrendRepository {
  constructor(private readonly pool: Pool) {}

  async getSettings(): Promise<TrendSettings> {
    const result = await this.pool.query<SettingsRow>('SELECT enabled, paused, threshold, daily_limit, sources FROM trend_settings WHERE id = 1');
    return result.rows[0] ? mapSettings(result.rows[0]) : DEFAULT_TREND_SETTINGS;
  }

  async updateSettings(settings: TrendSettings): Promise<TrendSettings> {
    await this.pool.query(
      `INSERT INTO trend_settings (id, enabled, paused, threshold, daily_limit, sources)
       VALUES (1, $1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET enabled = $1, paused = $2, threshold = $3, daily_limit = $4, sources = $5::jsonb, updated_at = now()`,
      [settings.enabled, settings.paused, settings.threshold, settings.dailyLimit, JSON.stringify(settings.sources)]
    );
    return this.getSettings();
  }

  /** Simpan item mentah; kembalikan true bila baru (dedupe per sumber+url). */
  async insertItem(item: {
    id: string; source: string; sourceName: string; title: string; url: string;
    summary?: string | null | undefined; publishedAt?: string | null | undefined;
    categories?: string[] | undefined; raw?: unknown;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO trend_items (id, source, source_name, title, url, summary, published_at, categories, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (source, url) DO NOTHING`,
      [item.id, item.source, item.sourceName, item.title, item.url, item.summary ?? null, item.publishedAt ?? null,
        item.categories ?? [], JSON.stringify(item.raw ?? null)]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async listItems(limit = 50): Promise<TrendItem[]> {
    const result = await this.pool.query<ItemRow>('SELECT * FROM trend_items ORDER BY fetched_at DESC LIMIT $1', [limit]);
    return result.rows.map(mapItem);
  }

  async listRecentItems(limit = 50): Promise<TrendItem[]> {
    const result = await this.pool.query<ItemRow>('SELECT * FROM trend_items ORDER BY published_at DESC NULLS LAST LIMIT $1', [limit]);
    return result.rows.map(mapItem);
  }

  async listCandidates(limit = 50): Promise<TrendCandidate[]> {
    const result = await this.pool.query<CandidateRow>(
      `SELECT c.*, i.title, i.url, i.source_name, i.published_at
       FROM trend_candidates c JOIN trend_items i ON i.id = c.trend_item_id
       ORDER BY c.created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(mapCandidate);
  }

  /** Simpan kandidat; kembalikan id kandidat, atau null bila item sudah pernah dikandidati. */
  async createCandidate(input: { id: string; itemId: string; score: number; threshold: number; reasons: TrendCandidate['reasons'] }): Promise<string | null> {
    const result = await this.pool.query(
      `INSERT INTO trend_candidates (id, trend_item_id, score, threshold, reasons)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (trend_item_id) DO NOTHING
       RETURNING id`,
      [input.id, input.itemId, input.score, input.threshold, JSON.stringify(input.reasons)]
    );
    return result.rows[0]?.id ?? null;
  }

  async markConverted(candidateId: string, draftId: string): Promise<void> {
    await this.pool.query(
      "UPDATE trend_candidates SET draft_id = $2, status = 'CONVERTED', updated_at = now() WHERE id = $1",
      [candidateId, draftId]
    );
  }

  async dismissCandidate(candidateId: string): Promise<void> {
    await this.pool.query(
      "UPDATE trend_candidates SET status = 'DISMISSED', updated_at = now() WHERE id = $1 AND status = 'PENDING'",
      [candidateId]
    );
  }

  /** Kandidat dibuat hari ini (WIB) — untuk menegakkan daily_limit. */
  async countCandidatesToday(): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      "SELECT count(*) n FROM trend_candidates WHERE created_at >= (now() AT TIME ZONE 'Asia/Jakarta')::date::timestamptz"
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  // --- Run discovery (outbox) ---
  async createRun(id: string, requestedBy: string | null): Promise<void> {
    await this.pool.query('INSERT INTO trend_runs (id, requested_by) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, requestedBy]);
  }
  async pendingRuns(limit = 20): Promise<Array<{ runId: string; requestedBy: string | null }>> {
    const result = await this.pool.query<{ id: string; requested_by: string | null }>(
      "SELECT id, requested_by FROM trend_runs WHERE status = 'QUEUED' ORDER BY created_at LIMIT $1", [limit]
    );
    return result.rows.map((row) => ({ runId: row.id, requestedBy: row.requested_by }));
  }
  async completeRun(id: string, result: unknown): Promise<void> {
    await this.pool.query("UPDATE trend_runs SET status = 'DONE', result = $2::jsonb, updated_at = now() WHERE id = $1", [id, JSON.stringify(result)]);
  }
  async failRun(id: string, error: string): Promise<void> {
    await this.pool.query("UPDATE trend_runs SET status = 'FAILED', result = $2::jsonb, updated_at = now() WHERE id = $1", [id, JSON.stringify({ error })]);
  }
  async getRun(id: string): Promise<{ id: string; status: string; result: unknown; createdAt: string; updatedAt: string } | null> {
    const result = await this.pool.query<{ id: string; status: string; result: unknown; created_at: Date; updated_at: Date }>(
      'SELECT id, status, result, created_at, updated_at FROM trend_runs WHERE id = $1', [id]
    );
    const row = result.rows[0];
    return row ? { id: row.id, status: row.status, result: row.result, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() } : null;
  }
}
