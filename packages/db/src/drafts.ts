import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { trendSourcesComplete } from '@threads-id/contracts';
import type { ContentFormat, DraftStatus } from '@threads-id/contracts';

export class DraftLockedError extends Error {
  constructor() { super('Draft terkunci; buka kunci sebelum mengubah'); }
}
export class DraftCancelledError extends Error {
  constructor() { super('Draft sudah dibatalkan'); }
}
export class DraftStateError extends Error {}
export class TrendSourcesError extends Error {
  constructor() { super('Draft tren memerlukan URL sumber, waktu sumber, dan kaitan audiens yang jelas'); }
}

export type Draft = {
  id: string; themeId: string; themeName: string; format: ContentFormat; text: string;
  status: DraftStatus; locked: boolean; sourceUrl: string | null; sourceTime: string | null;
  relevanceNote: string | null; personalSourceId: string | null; reviewNote: string | null;
  version: number; createdAt: string; updatedAt: string;
};
export type DraftInput = {
  themeId: string; format: ContentFormat; text: string;
  sourceUrl?: string | null | undefined; sourceTime?: string | null | undefined;
  relevanceNote?: string | null | undefined; personalSourceId?: string | null | undefined;
};
export type DraftPatch = { [K in keyof DraftInput]?: DraftInput[K] | undefined };
export type DraftFilter = { status?: DraftStatus | undefined; themeId?: string | undefined; format?: ContentFormat | undefined };

type DraftRow = {
  id: string; theme_id: string; theme_name: string; format: ContentFormat; text: string; status: DraftStatus;
  locked: boolean; source_url: string | null; source_time: Date | null; relevance_note: string | null;
  personal_source_id: string | null; review_note: string | null; version: number; created_at: Date; updated_at: Date;
};

const SELECT = `SELECT d.*, t.name AS theme_name FROM drafts d JOIN themes t ON t.id = d.theme_id`;

function mapDraft(row: DraftRow): Draft {
  return {
    id: row.id, themeId: row.theme_id, themeName: row.theme_name, format: row.format, text: row.text,
    status: row.status, locked: row.locked, sourceUrl: row.source_url,
    sourceTime: row.source_time ? row.source_time.toISOString() : null,
    relevanceNote: row.relevance_note, personalSourceId: row.personal_source_id, reviewNote: row.review_note,
    version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
  };
}

export class DraftRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: DraftInput): Promise<Draft> {
    const id = randomUUID();
    const status: DraftStatus = input.format === 'TREN_RELEVAN' ? 'IN_REVIEW' : 'DRAFT';
    await this.pool.query(
      `INSERT INTO drafts (id, theme_id, format, text, status, source_url, source_time, relevance_note, personal_source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, input.themeId, input.format, input.text, status, input.sourceUrl ?? null, input.sourceTime ?? null, input.relevanceNote ?? null, input.personalSourceId ?? null]
    );
    const draft = await this.get(id);
    if (!draft) throw new Error('Draft gagal dibuat');
    return draft;
  }

  async get(id: string): Promise<Draft | null> {
    const result = await this.pool.query<DraftRow>(`${SELECT} WHERE d.id = $1`, [id]);
    return result.rows[0] ? mapDraft(result.rows[0]) : null;
  }

  async list(filter: DraftFilter = {}): Promise<Draft[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.status) { values.push(filter.status); conditions.push(`d.status = $${values.length}`); }
    if (filter.themeId) { values.push(filter.themeId); conditions.push(`d.theme_id = $${values.length}`); }
    if (filter.format) { values.push(filter.format); conditions.push(`d.format = $${values.length}`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query<DraftRow>(`${SELECT} ${where} ORDER BY d.created_at DESC`, values);
    return result.rows.map(mapDraft);
  }

  /** Edit draft. Terkunci → ditolak keras di server; dibatalkan → ditolak; tren yang diedit kembali ke review. */
  async update(id: string, patch: DraftPatch): Promise<Draft> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Global Phase 1 lock order: settings -> draft -> schedule.
      await client.query('SELECT id FROM editorial_settings WHERE id = 1 FOR UPDATE');
      const current = await client.query<DraftRow>(`${SELECT} WHERE d.id = $1 FOR UPDATE OF d`, [id]);
      const row = current.rows[0];
      if (!row) throw new DraftStateError('Draft tidak ditemukan');
      if (row.locked) throw new DraftLockedError();
      if (row.status === 'CANCELLED') throw new DraftCancelledError();
      const format = patch.format ?? row.format;
      const next = {
        themeId: patch.themeId ?? row.theme_id,
        format,
        text: patch.text ?? row.text,
        sourceUrl: patch.sourceUrl !== undefined ? patch.sourceUrl : row.source_url,
        sourceTime: patch.sourceTime !== undefined ? patch.sourceTime : (row.source_time ? row.source_time.toISOString() : null),
        relevanceNote: patch.relevanceNote !== undefined ? patch.relevanceNote : row.relevance_note,
        personalSourceId: patch.personalSourceId !== undefined ? patch.personalSourceId : row.personal_source_id
      };
      // Setiap perubahan isi draft tren mengembalikannya ke antrean review.
      const status: DraftStatus = format === 'TREN_RELEVAN' ? 'IN_REVIEW' : row.status;
      if (status === 'IN_REVIEW') {
        // Invalidate queued versions atomically. Approval never silently reactivates them.
        const active = await client.query<{ id: string; version: number }>(
          "UPDATE schedule_entries SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE draft_id = $1 AND status = 'SCHEDULED' RETURNING id, version", [id]);
        for (const entry of active.rows) {
          await client.query("INSERT INTO schedule_outbox (id, schedule_id, version, event) VALUES ($1, $2, $3, 'CANCEL')", [randomUUID(), entry.id, entry.version]);
          await client.query("INSERT INTO schedule_executions (id, schedule_id, version, status, error) VALUES ($1, $2, $3, 'CANCELLED', 'Draft berubah; perlu review dan jadwal baru')", [randomUUID(), entry.id, entry.version]);
        }
      }
      await client.query(
        `UPDATE drafts SET theme_id = $2, format = $3, text = $4, status = $5, source_url = $6, source_time = $7,
         relevance_note = $8, personal_source_id = $9, version = version + 1, updated_at = now() WHERE id = $1`,
        [id, next.themeId, next.format, next.text, status, next.sourceUrl, next.sourceTime, next.relevanceNote, next.personalSourceId]
      );
      if (status !== 'IN_REVIEW') {
        // A job that already read the old text must not complete this replacement version.
        const active = await client.query<{ id: string; version: number; scheduled_at: Date }>(
          "UPDATE schedule_entries SET version = version + 1, updated_at = now() WHERE draft_id = $1 AND status = 'SCHEDULED' RETURNING id, version, scheduled_at", [id]);
        for (const entry of active.rows) {
          await client.query("INSERT INTO schedule_outbox (id, schedule_id, version, event, scheduled_at) VALUES ($1, $2, $3, 'UPSERT', $4)", [randomUUID(), entry.id, entry.version, entry.scheduled_at]);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const draft = await this.get(id);
    if (!draft) throw new DraftStateError('Draft tidak ditemukan');
    return draft;
  }

  async setLocked(id: string, locked: boolean): Promise<Draft | null> {
    const result = await this.pool.query('UPDATE drafts SET locked = $2, updated_at = now() WHERE id = $1', [id, locked]);
    if ((result.rowCount ?? 0) === 0) return null;
    return this.get(id);
  }

  async review(id: string, decision: 'APPROVE' | 'REJECT', note?: string): Promise<Draft> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Global Phase 1 lock order: settings -> draft -> schedule.
      await client.query('SELECT id FROM editorial_settings WHERE id = 1 FOR UPDATE');
      const current = await client.query<DraftRow>(`${SELECT} WHERE d.id = $1 FOR UPDATE OF d`, [id]);
      const row = current.rows[0];
      if (!row) throw new DraftStateError('Draft tidak ditemukan');
      if (row.status !== 'IN_REVIEW') throw new DraftStateError('Hanya draft berstatus IN_REVIEW yang bisa direview');
      if (decision === 'APPROVE') {
        if (!trendSourcesComplete({ format: row.format, sourceUrl: row.source_url, sourceTime: row.source_time ? row.source_time.toISOString() : null, relevanceNote: row.relevance_note })) {
          throw new TrendSourcesError();
        }
        await client.query('UPDATE drafts SET status = \'APPROVED\', review_note = $2, version = version + 1, updated_at = now() WHERE id = $1', [id, note ?? row.review_note]);
      } else {
        await client.query('UPDATE drafts SET status = \'DRAFT\', review_note = $2, version = version + 1, updated_at = now() WHERE id = $1', [id, note ?? null]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const draft = await this.get(id);
    if (!draft) throw new DraftStateError('Draft tidak ditemukan');
    return draft;
  }

  /** Batalkan draft beserta jadwal aktifnya (outbox CANCEL dicatat dalam transaksi yang sama). */
  async cancel(id: string): Promise<Draft> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Global Phase 1 lock order: settings -> draft -> schedule.
      await client.query('SELECT id FROM editorial_settings WHERE id = 1 FOR UPDATE');
      const current = await client.query<{ status: DraftStatus; format: ContentFormat }>('SELECT status, format FROM drafts WHERE id = $1 FOR UPDATE', [id]);
      const row = current.rows[0];
      if (!row) throw new DraftStateError('Draft tidak ditemukan');
      if (row.status !== 'CANCELLED') {
        await client.query('UPDATE drafts SET status = \'CANCELLED\', version = version + 1, updated_at = now() WHERE id = $1', [id]);
      }
      const schedules = await client.query<{ id: string; version: number }>('SELECT id, version FROM schedule_entries WHERE draft_id = $1 AND status = \'SCHEDULED\' FOR UPDATE', [id]);
      for (const schedule of schedules.rows) {
        const nextVersion = schedule.version + 1;
        await client.query('UPDATE schedule_entries SET status = \'CANCELLED\', version = $2, updated_at = now() WHERE id = $1', [schedule.id, nextVersion]);
        await client.query('INSERT INTO schedule_outbox (id, schedule_id, version, event) VALUES ($1, $2, $3, \'CANCEL\')', [randomUUID(), schedule.id, nextVersion]);
        await client.query(
          'INSERT INTO schedule_executions (id, schedule_id, version, status) VALUES ($1, $2, $3, \'CANCELLED\') ON CONFLICT (schedule_id, version) DO NOTHING',
          [randomUUID(), schedule.id, nextVersion]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const draft = await this.get(id);
    if (!draft) throw new DraftStateError('Draft tidak ditemukan');
    return draft;
  }
}
