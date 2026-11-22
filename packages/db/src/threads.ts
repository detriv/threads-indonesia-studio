import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { PublishStatus, ThreadsConnectionStatus, ThreadsPublishTrigger } from '@threads-id/contracts';
import { THREADS_SCOPES } from '@threads-id/contracts';

export class ThreadsConfigError extends Error {}
export class ThreadsLiveDisabledError extends Error {
  constructor() { super('Publikasi live Threads belum diaktifkan operator; eksekusi dikembalikan ke simulasi.'); }
}

export type ThreadsConnection = {
  appId: string | null;
  appSecretPresent: boolean;
  userId: string | null;
  accessTokenPresent: boolean;
  tokenExpiresAt: string | null;
  scopes: string | null;
  status: ThreadsConnectionStatus;
  livePosting: boolean;
  note: string | null;
};

export type PublishQueueRow = {
  id: string; draftId: string; scheduleId: string | null; trigger: ThreadsPublishTrigger;
  status: PublishStatus; containerId: string | null; mediaId: string | null; publishedUrl: string | null;
  attemptCount: number; lastErrorCode: string | null; lastError: string | null; requestedBy: string | null;
  createdAt: string; updatedAt: string;
};

type ConnectionRow = {
  app_id: string | null; app_secret_present: boolean; user_id: string | null; access_token_present: boolean;
  token_expires_at: Date | null; scopes: string | null; status: ThreadsConnectionStatus; live_posting: boolean; note: string | null;
};

type QueueRow = {
  id: string; draft_id: string; schedule_id: string | null; trigger: ThreadsPublishTrigger; status: PublishStatus;
  container_id: string | null; media_id: string | null; published_url: string | null; attempt_count: number;
  last_error_code: string | null; last_error: string | null; requested_by: string | null;
  created_at: Date; updated_at: Date;
};

export function threadsEnv(): {
  appId: string; appSecret: string; userId: string; accessToken: string;
  livePosting: boolean; scopes: string[];
} {
  // Default mengikuti kontrak (termasuk scope balasan Fase 4B), bukan daftar hardcode.
  const rawScopes = (process.env.THREADS_SCOPES ?? THREADS_SCOPES.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);
  return {
    appId: (process.env.THREADS_APP_ID ?? '').trim(),
    appSecret: (process.env.THREADS_APP_SECRET ?? '').trim(),
    userId: (process.env.THREADS_USER_ID ?? '').trim(),
    accessToken: (process.env.THREADS_ACCESS_TOKEN ?? '').trim(),
    livePosting: process.env.THREADS_LIVE_POSTING === 'true',
    scopes: rawScopes
  };
}

export function connectionStatusFromEnv(): ThreadsConnectionStatus {
  const env = threadsEnv();
  if (!env.appId || !env.appSecret || !env.userId || !env.accessToken) return 'NOT_CONFIGURED';
  return env.livePosting ? 'CONNECTED' : 'DISCONNECTED';
}

/** Token long-lived Threads: 60 hari; muat kembali aman lewat endpoint refresh Meta. */
export function tokenExpired(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= now;
}

export class ThreadsRepository {
  constructor(readonly pool: pg.Pool) {}

  async upsertConnection(input: {
    appId?: string | undefined; appSecretPresent?: boolean | undefined; userId?: string | undefined;
    accessTokenPresent?: boolean | undefined; tokenExpiresAt?: string | null | undefined;
    scopes?: string | null | undefined; status?: ThreadsConnectionStatus | undefined;
    livePosting?: boolean | undefined; note?: string | null | undefined;
  }): Promise<ThreadsConnection> {
    await this.pool.query(
      `INSERT INTO threads_connection (id, app_id, app_secret_present, user_id, access_token_present, token_expires_at, scopes, status, live_posting, note)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         app_id = COALESCE(EXCLUDED.app_id, threads_connection.app_id),
         app_secret_present = EXCLUDED.app_secret_present,
         user_id = COALESCE(EXCLUDED.user_id, threads_connection.user_id),
         access_token_present = EXCLUDED.access_token_present,
         token_expires_at = COALESCE(EXCLUDED.token_expires_at, threads_connection.token_expires_at),
         scopes = COALESCE(EXCLUDED.scopes, threads_connection.scopes),
         status = EXCLUDED.status,
         live_posting = EXCLUDED.live_posting,
         note = COALESCE(EXCLUDED.note, threads_connection.note),
         updated_at = now()`,
      [input.appId ?? null, input.appSecretPresent ?? false, input.userId ?? null, input.accessTokenPresent ?? false,
        input.tokenExpiresAt ?? null, input.scopes ?? null, input.status ?? 'DISCONNECTED',
        input.livePosting ?? false, input.note ?? null]
    );
    const connection = await this.getConnection();
    if (!connection) throw new Error('Koneksi Threads gagal disimpan');
    return connection;
  }

  async getConnection(): Promise<ThreadsConnection | null> {
    const result = await this.pool.query<ConnectionRow>('SELECT * FROM threads_connection WHERE id = 1');
    const row = result.rows[0];
    if (!row) return null;
    return {
      appId: row.app_id, appSecretPresent: row.app_secret_present, userId: row.user_id,
      accessTokenPresent: row.access_token_present,
      tokenExpiresAt: row.token_expires_at ? row.token_expires_at.toISOString() : null,
      scopes: row.scopes, status: row.status, livePosting: row.live_posting, note: row.note
    };
  }

  /** Perbarui token setelah refresh otomatis (nilai token sendiri tidak pernah disimpan di DB). */
  async updateToken(tokenExpiresAt: string, accessTokenPresent = true): Promise<void> {
    await this.pool.query(
      'UPDATE threads_connection SET token_expires_at = $1, access_token_present = $2, updated_at = now() WHERE id = 1',
      [tokenExpiresAt, accessTokenPresent]
    );
  }

  async setLivePosting(livePosting: boolean, note?: string): Promise<ThreadsConnection> {
    const current = await this.getConnection();
    const env = threadsEnv();
    const status: ThreadsConnectionStatus = !env.appId || !env.appSecret || !env.userId || !env.accessToken
      ? 'NOT_CONFIGURED'
      : livePosting ? 'CONNECTED' : 'DISCONNECTED';
    return this.upsertConnection({
      appId: current?.appId ?? (env.appId || undefined),
      appSecretPresent: current?.appSecretPresent ?? Boolean(env.appSecret),
      userId: current?.userId ?? (env.userId || undefined),
      accessTokenPresent: current?.accessTokenPresent ?? Boolean(env.accessToken),
      tokenExpiresAt: current?.tokenExpiresAt ?? null,
      scopes: current?.scopes ?? env.scopes.join(','),
      status,
      livePosting,
      note: note ?? (livePosting
        ? 'Publikasi live diaktifkan operator. Tetap memerlukan kredensial lengkap dan token belum kedaluwarsa.'
        : 'Publikasi live dimatikan operator; eksekusi jadwal kembali ke simulasi.')
    });
  }

  // ===== Publish queue =====
  async enqueue(input: { id?: string | undefined; draftId: string; scheduleId?: string | null | undefined; trigger: ThreadsPublishTrigger; requestedBy?: string | null | undefined; liveEnabled: boolean }): Promise<PublishQueueRow> {
    const id = input.id ?? randomUUID();
    if (!input.liveEnabled) {
      // Tetap tercatat sebagai bukti, bukan post nyata: operator melihat alasan penolakan.
      await this.pool.query(
        `INSERT INTO publish_queue (id, draft_id, schedule_id, trigger, status, last_error_code, last_error, requested_by)
         VALUES ($1, $2, $3, $4, 'REQUIRES_LIVE', 'LIVE_DISABLED', 'Publikasi live belum diaktifkan operator; tidak ada post nyata.', $5)
         ON CONFLICT (id) DO NOTHING`,
        [id, input.draftId, input.scheduleId ?? null, input.trigger, input.requestedBy ?? null]
      );
      const row = await this.getQueue(id);
      if (!row) throw new Error('Antrean publikasi gagal dibuat');
      return row;
    }
    await this.pool.query(
      `INSERT INTO publish_queue (id, draft_id, schedule_id, trigger, status, requested_by)
       VALUES ($1, $2, $3, $4, 'QUEUED', $5) ON CONFLICT (id) DO NOTHING`,
      [id, input.draftId, input.scheduleId ?? null, input.trigger, input.requestedBy ?? null]
    );
    const row = await this.getQueue(id);
    if (!row) throw new Error('Antrean publikasi gagal dibuat');
    return row;
  }

  async getQueue(id: string): Promise<PublishQueueRow | null> {
    const result = await this.pool.query<QueueRow>('SELECT * FROM publish_queue WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? mapQueue(row) : null;
  }

  async listQueue(filter: { status?: PublishStatus | undefined; limit?: number | undefined } = {}): Promise<PublishQueueRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.status) { values.push(filter.status); conditions.push(`status = $${values.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(filter.limit ?? 100);
    const result = await this.pool.query<QueueRow>(
      `SELECT * FROM publish_queue ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values
    );
    return result.rows.map(mapQueue);
  }

  async pendingQueue(): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM publish_queue WHERE status IN ('QUEUED','CONTAINER_CREATED','NEEDS_REVIEW') ORDER BY created_at LIMIT 50"
    );
    return result.rows.map((r) => r.id);
  }

  /** Klaim atomik satu baris antrean; hanya baris yang diklaim yang boleh memanggil Meta. */
  async claimQueue(id: string): Promise<PublishQueueRow | null> {
    const result = await this.pool.query<QueueRow>(
      "UPDATE publish_queue SET status = 'CONTAINER_CREATED', attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1 AND status = 'QUEUED' RETURNING *",
      [id]
    );
    return result.rows[0] ? mapQueue(result.rows[0]) : null;
  }

  async setContainer(id: string, containerId: string): Promise<void> {
    await this.pool.query("UPDATE publish_queue SET container_id = $2, status = 'CONTAINER_CREATED', updated_at = now() WHERE id = $1", [id, containerId]);
  }

  async completePublished(id: string, mediaId: string, publishedUrl: string | null): Promise<void> {
    await this.pool.query(
      "UPDATE publish_queue SET status = 'PUBLISHED', media_id = $2, published_url = $3, updated_at = now() WHERE id = $1",
      [id, mediaId, publishedUrl]
    );
  }

  async markNeedsReview(id: string, code: string, message: string): Promise<void> {
    await this.pool.query(
      "UPDATE publish_queue SET status = 'NEEDS_REVIEW', last_error_code = $2, last_error = $3, updated_at = now() WHERE id = $1",
      [id, code, message]
    );
  }

  async markDuplicate(id: string, mediaId: string): Promise<void> {
    await this.pool.query(
      "UPDATE publish_queue SET status = 'DUPLICATE', media_id = $2, updated_at = now() WHERE id = $1",
      [id, mediaId]
    );
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    await this.pool.query(
      "UPDATE publish_queue SET status = 'FAILED', last_error_code = $2, last_error = $3, updated_at = now() WHERE id = $1",
      [id, code, message]
    );
  }

  async recordAttempt(input: {
    queueId: string; step: 'CREATE_CONTAINER' | 'PUBLISH' | 'STATUS' | 'QUOTA';
    outcome: 'OK' | 'AMBIGUOUS' | 'DUPLICATE' | 'FAILED' | 'BLOCKED';
    httpStatus?: number | null | undefined; errorCode?: string | null | undefined; error?: string | null | undefined;
    containerId?: string | null | undefined; mediaId?: string | null | undefined;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO publish_attempts (id, queue_id, step, outcome, http_status, error_code, error, container_id, media_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), input.queueId, input.step, input.outcome, input.httpStatus ?? null,
        input.errorCode ?? null, input.error ?? null, input.containerId ?? null, input.mediaId ?? null]
    );
  }

  async listAttempts(queueId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query(
      'SELECT * FROM publish_attempts WHERE queue_id = $1 ORDER BY created_at', [queueId]
    );
    return result.rows;
  }

  /** Rekonsiliasi: publish gagal/timeout setelah container mungkin sudah live. Operator menutup secara eksplisit. */
  async resolveNeedsReview(id: string, resolution: 'PUBLISHED' | 'FAILED', mediaId?: string): Promise<PublishQueueRow | null> {
    const result = await this.pool.query<QueueRow>(
      `UPDATE publish_queue SET status = $2, media_id = COALESCE($3, media_id), updated_at = now()
       WHERE id = $1 AND status = 'NEEDS_REVIEW' RETURNING *`,
      [id, resolution, mediaId ?? null]
    );
    return result.rows[0] ? mapQueue(result.rows[0]) : null;
  }
}

function mapQueue(row: QueueRow): PublishQueueRow {
  return {
    id: row.id, draftId: row.draft_id, scheduleId: row.schedule_id, trigger: row.trigger, status: row.status,
    containerId: row.container_id, mediaId: row.media_id, publishedUrl: row.published_url,
    attemptCount: row.attempt_count, lastErrorCode: row.last_error_code, lastError: row.last_error,
    requestedBy: row.requested_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
  };
}
