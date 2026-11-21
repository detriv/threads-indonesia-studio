import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ContentFormat, EditorialSettings, ExecutionStatus, ScheduleStatus } from '@threads-id/contracts';

export class DailyLimitError extends Error {
  constructor(limit: number) { super(`Batas harian ${limit} post untuk hari Jakarta tersebut sudah tercapai`); }
}
export class ScheduleStateError extends Error {}
export class ScheduleConflictError extends Error {}

export type ScheduleEntry = {
  id: string; draftId: string; draftText: string; themeName: string; format: ContentFormat;
  scheduledAt: string; status: ScheduleStatus; version: number; createdAt: string; updatedAt: string;
};
export type ScheduleFilter = { status?: ScheduleStatus | undefined; from?: string | undefined; to?: string | undefined };
export type HistoryFilter = {
  status?: ExecutionStatus | undefined; themeId?: string | undefined; format?: ContentFormat | undefined;
  from?: string | undefined; to?: string | undefined; limit?: number | undefined;
};
export type HistoryItem = {
  id: string; scheduleId: string; draftId: string | null; draftText: string | null; themeId: string | null; themeName: string | null;
  format: ContentFormat | null; draftStatus: string | null; scheduledAt: string | null; executedAt: string;
  snapshotProvenance: string;
  status: ExecutionStatus; version: number; result: Record<string, unknown> | null; error: string | null; demo: true;
};
type HistoryRow = {
  id: string; schedule_id: string; version: number; status: ExecutionStatus; result: Record<string, unknown> | null;
  error: string | null; executed_at: Date; draft_id: string | null; scheduled_at: Date | null; draft_text: string | null;
  format: ContentFormat | null; draft_status: string | null; theme_id: string | null; theme_name: string | null; provenance: string;
};
export type WorkerScheduleView = {
  entry: { id: string; draftId: string; scheduledAt: string; status: ScheduleStatus; version: number };
  draft: { id: string; text: string; format: ContentFormat; status: string; themeName: string };
  settings: EditorialSettings;
};

type EntryRow = {
  id: string; draft_id: string; draft_text: string; theme_name: string; format: ContentFormat;
  scheduled_at: Date; status: ScheduleStatus; version: number; created_at: Date; updated_at: Date;
};

const SELECT = `SELECT s.*, d.text AS draft_text, d.format, t.name AS theme_name
  FROM schedule_entries s JOIN drafts d ON d.id = s.draft_id JOIN themes t ON t.id = d.theme_id`;

function mapEntry(row: EntryRow): ScheduleEntry {
  return {
    id: row.id, draftId: row.draft_id, draftText: row.draft_text, themeName: row.theme_name, format: row.format,
    scheduledAt: row.scheduled_at.toISOString(), status: row.status, version: row.version,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
  };
}

const DAY_SQL = `(scheduled_at AT TIME ZONE 'Asia/Jakarta')::date = ($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date`;

export class ScheduleRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(draftId: string, scheduledAt: Date): Promise<ScheduleEntry> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Single-account Phase 1 quota mutex; always acquire before draft/schedule locks.
      await client.query('SELECT id FROM editorial_settings WHERE id = 1 FOR UPDATE');
      const draftResult = await client.query<{ status: string; format: ContentFormat }>('SELECT status, format FROM drafts WHERE id = $1 FOR UPDATE', [draftId]);
      const draft = draftResult.rows[0];
      if (!draft) throw new ScheduleStateError('Draft tidak ditemukan');
      if (draft.status === 'CANCELLED') throw new ScheduleStateError('Draft sudah dibatalkan');
      if (draft.status === 'IN_REVIEW') throw new ScheduleStateError('Selesaikan review draft sebelum menjadwalkan');
      if (draft.format === 'TREN_RELEVAN' && draft.status !== 'APPROVED' && draft.status !== 'SCHEDULED') {
        throw new ScheduleStateError('Draft tren harus disetujui lewat review sebelum dijadwalkan');
      }
      const settings = await client.query<{ daily_post_limit: number }>('SELECT daily_post_limit FROM editorial_settings WHERE id = 1');
      const limit = settings.rows[0]?.daily_post_limit ?? 2;
      const count = await client.query<{ n: string }>(`SELECT count(*)::int AS n FROM schedule_entries WHERE status IN ('SCHEDULED','COMPLETED') AND ${DAY_SQL}`, [scheduledAt]);
      if (Number(count.rows[0]?.n ?? 0) >= limit) throw new DailyLimitError(limit);
      await client.query('INSERT INTO schedule_entries (id, draft_id, scheduled_at, status, version) VALUES ($1, $2, $3, \'SCHEDULED\', 1)', [id, draftId, scheduledAt]);
      await client.query('INSERT INTO schedule_outbox (id, schedule_id, version, event, scheduled_at) VALUES ($1, $2, 1, \'UPSERT\', $3)', [randomUUID(), id, scheduledAt]);
      await client.query('UPDATE drafts SET status = \'SCHEDULED\', updated_at = now() WHERE id = $1 AND status <> \'SCHEDULED\'', [draftId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const entry = await this.get(id);
    if (!entry) throw new ScheduleStateError('Jadwal gagal dibuat');
    return entry;
  }

  async reschedule(id: string, scheduledAt: Date): Promise<ScheduleEntry> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Single-account Phase 1 quota mutex; always acquire before draft/schedule locks.
      await client.query('SELECT id FROM editorial_settings WHERE id = 1 FOR UPDATE');
      await client.query('SELECT id FROM drafts WHERE id = (SELECT draft_id FROM schedule_entries WHERE id = $1) FOR UPDATE', [id]);
      const current = await client.query<{ status: ScheduleStatus; version: number; draft_id: string }>('SELECT status, version, draft_id FROM schedule_entries WHERE id = $1 FOR UPDATE', [id]);
      const entry = current.rows[0];
      if (!entry) throw new ScheduleStateError('Jadwal tidak ditemukan');
      if (entry.status !== 'SCHEDULED') throw new ScheduleConflictError('Hanya jadwal aktif yang bisa dijadwalkan ulang');
      const settings = await client.query<{ daily_post_limit: number }>('SELECT daily_post_limit FROM editorial_settings WHERE id = 1');
      const limit = settings.rows[0]?.daily_post_limit ?? 2;
      const count = await client.query<{ n: string }>(`SELECT count(*)::int AS n FROM schedule_entries WHERE status IN ('SCHEDULED','COMPLETED') AND id <> $2 AND ${DAY_SQL}`, [scheduledAt, id]);
      if (Number(count.rows[0]?.n ?? 0) >= limit) throw new DailyLimitError(limit);
      const nextVersion = entry.version + 1;
      await client.query('UPDATE schedule_entries SET scheduled_at = $2, version = $3, updated_at = now() WHERE id = $1', [id, scheduledAt, nextVersion]);
      await client.query('INSERT INTO schedule_outbox (id, schedule_id, version, event, scheduled_at) VALUES ($1, $2, $3, \'UPSERT\', $4)', [randomUUID(), id, nextVersion, scheduledAt]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const entry = await this.get(id);
    if (!entry) throw new ScheduleStateError('Jadwal tidak ditemukan');
    return entry;
  }

  async cancel(id: string): Promise<ScheduleEntry> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Single-account Phase 1 quota mutex; always acquire before draft/schedule locks.
      await client.query('SELECT id FROM editorial_settings WHERE id = 1 FOR UPDATE');
      await client.query('SELECT id FROM drafts WHERE id = (SELECT draft_id FROM schedule_entries WHERE id = $1) FOR UPDATE', [id]);
      const current = await client.query<{ status: ScheduleStatus; version: number; draft_id: string }>('SELECT status, version, draft_id FROM schedule_entries WHERE id = $1 FOR UPDATE', [id]);
      const entry = current.rows[0];
      if (!entry) throw new ScheduleStateError('Jadwal tidak ditemukan');
      if (entry.status !== 'SCHEDULED') throw new ScheduleConflictError('Hanya jadwal aktif yang bisa dibatalkan');
      const nextVersion = entry.version + 1;
      await client.query('UPDATE schedule_entries SET status = \'CANCELLED\', version = $2, updated_at = now() WHERE id = $1', [id, nextVersion]);
      await client.query('INSERT INTO schedule_outbox (id, schedule_id, version, event) VALUES ($1, $2, $3, \'CANCEL\')', [randomUUID(), id, nextVersion]);
      await client.query('INSERT INTO schedule_executions (id, schedule_id, version, status) VALUES ($1, $2, $3, \'CANCELLED\') ON CONFLICT (schedule_id, version) DO NOTHING', [randomUUID(), id, nextVersion]);
      const remaining = await client.query<{ n: string }>('SELECT count(*)::int AS n FROM schedule_entries WHERE draft_id = $1 AND status = \'SCHEDULED\' AND id <> $2', [entry.draft_id, id]);
      if (Number(remaining.rows[0]?.n ?? 0) === 0) {
        await client.query('UPDATE drafts SET status = CASE WHEN format = \'TREN_RELEVAN\' THEN \'APPROVED\' ELSE \'DRAFT\' END, updated_at = now() WHERE id = $1 AND status = \'SCHEDULED\'', [entry.draft_id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const entry = await this.get(id);
    if (!entry) throw new ScheduleStateError('Jadwal tidak ditemukan');
    return entry;
  }

  async get(id: string): Promise<ScheduleEntry | null> {
    const result = await this.pool.query<EntryRow>(`${SELECT} WHERE s.id = $1`, [id]);
    return result.rows[0] ? mapEntry(result.rows[0]) : null;
  }

  async list(filter: ScheduleFilter = {}): Promise<ScheduleEntry[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.status) { values.push(filter.status); conditions.push(`s.status = $${values.length}`); }
    if (filter.from) { values.push(filter.from); conditions.push(`s.scheduled_at >= $${values.length}`); }
    if (filter.to) { values.push(filter.to); conditions.push(`s.scheduled_at <= $${values.length}`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query<EntryRow>(`${SELECT} ${where} ORDER BY s.scheduled_at ASC`, values);
    return result.rows.map(mapEntry);
  }

  // ===== Sisi worker =====
  async getForWorker(scheduleId: string): Promise<WorkerScheduleView | null> {
    const result = await this.pool.query<EntryRow & { draft_status: string; format_mix: EditorialSettings['formatMix']; daily_post_limit: number; paused: boolean }>(
      `SELECT s.*, d.text AS draft_text, d.format, d.status AS draft_status, t.name AS theme_name,
              es.format_mix, es.daily_post_limit, es.paused
       FROM schedule_entries s
       JOIN drafts d ON d.id = s.draft_id
       JOIN themes t ON t.id = d.theme_id
       CROSS JOIN editorial_settings es
       WHERE s.id = $1 AND es.id = 1`, [scheduleId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      entry: { id: row.id, draftId: row.draft_id, scheduledAt: row.scheduled_at.toISOString(), status: row.status, version: row.version },
      draft: { id: row.draft_id, text: row.draft_text, format: row.format, status: row.draft_status, themeName: row.theme_name },
      settings: { formatMix: row.format_mix, dailyPostLimit: row.daily_post_limit, paused: row.paused }
    };
  }

  /** Klaim atomik: hanya job dengan versi cocok dan status SCHEDULED yang boleh menyelesaikan simulasi. */
  async completeSimulation(scheduleId: string, version: number, result: Record<string, unknown>): Promise<'SIMULATED_OK' | 'SKIPPED_LIMIT' | 'DEFERRED_PAUSED' | 'DUPLICATE'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Global Phase 1 lock order: settings -> draft -> schedule.
      await client.query('SELECT id FROM editorial_settings WHERE id = 1 FOR UPDATE');
      await client.query('SELECT id FROM drafts WHERE id = (SELECT draft_id FROM schedule_entries WHERE id = $1) FOR UPDATE', [scheduleId]);
      const eligible = await client.query(
        `SELECT s.id FROM schedule_entries s JOIN drafts d ON d.id = s.draft_id
         CROSS JOIN editorial_settings es WHERE s.id = $1 AND s.version = $2
         AND s.status = 'SCHEDULED' AND d.status NOT IN ('IN_REVIEW','CANCELLED')
         AND (d.format <> 'TREN_RELEVAN' OR d.status IN ('APPROVED','SCHEDULED'))
         AND es.id = 1 AND NOT es.paused FOR UPDATE OF s`, [scheduleId, version]);
      if (eligible.rowCount === 0) {
        const paused = await client.query<{ paused: boolean }>('SELECT paused FROM editorial_settings WHERE id = 1');
        await client.query('ROLLBACK');
        return paused.rows[0]?.paused ? 'DEFERRED_PAUSED' : 'DUPLICATE';
      }
      // Count and commit under the same settings-row mutex as reservations and settings updates.
      const quota = await client.query<{ used: number; daily_post_limit: number }>(
        `SELECT es.daily_post_limit, (SELECT count(*)::int FROM schedule_executions e
          JOIN schedule_entries prior ON prior.id = e.schedule_id
          WHERE e.status = 'SIMULATED_OK' AND (prior.scheduled_at AT TIME ZONE 'Asia/Jakarta')::date =
            (s.scheduled_at AT TIME ZONE 'Asia/Jakarta')::date) AS used
         FROM schedule_entries s CROSS JOIN editorial_settings es WHERE s.id = $1 AND es.id = 1`, [scheduleId]);
      const quotaRow = quota.rows[0]!;
      if (quotaRow.used >= quotaRow.daily_post_limit) {
        await client.query("INSERT INTO schedule_executions (id, schedule_id, version, status) VALUES ($1, $2, $3, 'SKIPPED_LIMIT') ON CONFLICT (schedule_id, version) DO NOTHING", [randomUUID(), scheduleId, version]);
        await client.query('COMMIT');
        return 'SKIPPED_LIMIT';
      }
      const existing = await client.query('SELECT id FROM schedule_executions WHERE schedule_id = $1 AND version = $2', [scheduleId, version]);
      if (existing.rowCount) { await client.query('ROLLBACK'); return 'DUPLICATE'; }
      const claimed = await client.query('UPDATE schedule_entries SET status = \'COMPLETED\', updated_at = now() WHERE id = $1 AND version = $2 AND status = \'SCHEDULED\' RETURNING id', [scheduleId, version]);
      if ((claimed.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); return 'DUPLICATE'; }
      await client.query(
        'INSERT INTO schedule_executions (id, schedule_id, version, status, result) VALUES ($1, $2, $3, \'SIMULATED_OK\', $4::jsonb) ON CONFLICT (schedule_id, version) DO NOTHING',
        [randomUUID(), scheduleId, version, JSON.stringify(result)]
      );
      await client.query('COMMIT');
      return 'SIMULATED_OK';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Catat skip (stale/cancel/limit) secara idempoten per (schedule_id, version). */
  async recordSkip(scheduleId: string, version: number, status: ExecutionStatus, error?: string): Promise<boolean> {
    const result = await this.pool.query(
      'INSERT INTO schedule_executions (id, schedule_id, version, status, error) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (schedule_id, version) DO NOTHING RETURNING id',
      [randomUUID(), scheduleId, version, status, error ?? null]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countSimulatedOkForDay(scheduledAt: Date): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM schedule_executions e JOIN schedule_entries s ON s.id = e.schedule_id
       WHERE e.status = 'SIMULATED_OK' AND (s.scheduled_at AT TIME ZONE 'Asia/Jakarta')::date = ($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date`,
      [scheduledAt]
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  /** Riwayat eksekusi/pembatalan dengan payload domain; filter waktu mengacu pada tanggal jadwal. */
  async listExecutions(filter: HistoryFilter = {}): Promise<HistoryItem[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.status) { values.push(filter.status); conditions.push(`e.status = $${values.length}`); }
    if (filter.themeId) { values.push(filter.themeId); conditions.push(`e.snapshot->>'themeId' = $${values.length}`); }
    if (filter.format) { values.push(filter.format); conditions.push(`e.snapshot->>'format' = $${values.length}`); }
    if (filter.from) { values.push(filter.from); conditions.push(`(e.snapshot->>'scheduledAt')::timestamptz >= $${values.length}`); }
    if (filter.to) { values.push(filter.to); conditions.push(`(e.snapshot->>'scheduledAt')::timestamptz <= $${values.length}`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(filter.limit ?? 100);
    const result = await this.pool.query<HistoryRow>(
      `SELECT e.id, e.schedule_id, e.version, e.status, e.result, e.error, e.created_at AS executed_at,
              e.snapshot->>'draftId' AS draft_id, (e.snapshot->>'scheduledAt')::timestamptz AS scheduled_at,
              e.snapshot->>'draftText' AS draft_text, e.snapshot->>'format' AS format,
              e.snapshot->>'draftStatus' AS draft_status, e.snapshot->>'themeId' AS theme_id,
              e.snapshot->>'themeName' AS theme_name, e.snapshot->>'provenance' AS provenance
       FROM schedule_executions e
       ${where} ORDER BY e.created_at DESC LIMIT $${values.length}`, values
    );
    return result.rows.map((row) => ({
      id: row.id, scheduleId: row.schedule_id, draftId: row.draft_id, draftText: row.draft_text,
      themeId: row.theme_id, themeName: row.theme_name, format: row.format, draftStatus: row.draft_status,
      scheduledAt: row.scheduled_at?.toISOString() ?? null, executedAt: row.executed_at.toISOString(),
      snapshotProvenance: row.provenance,
      status: row.status, version: row.version, result: row.result, error: row.error, demo: true
    }));
  }
}
