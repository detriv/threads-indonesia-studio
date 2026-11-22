import type { Pool } from 'pg';
import type { ReplyQueueItem, ReplySettings } from '@threads-id/contracts';

type SettingsRow = {
  live_posting: boolean; paused: boolean; daily_limit: number;
  quota_usage: number | null; quota_total: number | null; quota_synced_at: Date | null;
};

type ReplyRow = {
  id: string; reply_to_id: string; text: string; status: ReplyQueueItem['status'];
  container_id: string | null; media_id: string | null; attempt_count: number;
  last_error_code: string | null; last_error: string | null; requested_by: string | null;
  created_at: Date; updated_at: Date;
};

function mapReply(row: ReplyRow): ReplyQueueItem {
  return {
    id: row.id, replyToId: row.reply_to_id, text: row.text, status: row.status,
    containerId: row.container_id, mediaId: row.media_id, attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code, lastError: row.last_error, requestedBy: row.requested_by,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
  };
}

function mapSettings(row: SettingsRow): ReplySettings {
  return {
    livePosting: row.live_posting, paused: row.paused, dailyLimit: row.daily_limit,
    quotaUsage: row.quota_usage, quotaTotal: row.quota_total,
    quotaSyncedAt: row.quota_synced_at ? row.quota_synced_at.toISOString() : null
  };
}

export class ReplyRepository {
  constructor(private readonly pool: Pool) {}

  async getSettings(): Promise<ReplySettings> {
    const result = await this.pool.query<SettingsRow>('SELECT live_posting, paused, daily_limit, quota_usage, quota_total, quota_synced_at FROM reply_settings WHERE id = 1');
    if (result.rows[0]) return mapSettings(result.rows[0]);
    // Bawaan jujur: live balasan mati, kuota belum diketahui.
    return { livePosting: false, paused: false, dailyLimit: 20, quotaUsage: null, quotaTotal: null, quotaSyncedAt: null };
  }

  async updateSettings(input: { livePosting: boolean; paused: boolean; dailyLimit: number }): Promise<ReplySettings> {
    await this.pool.query(
      `INSERT INTO reply_settings (id, live_posting, paused, daily_limit)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET live_posting = $1, paused = $2, daily_limit = $3, updated_at = now()`,
      [input.livePosting, input.paused, input.dailyLimit]
    );
    return this.getSettings();
  }

  async syncQuota(usage: number | null, total: number | null): Promise<void> {
    await this.pool.query(
      'UPDATE reply_settings SET quota_usage = $1, quota_total = $2, quota_synced_at = now(), updated_at = now() WHERE id = 1',
      [usage, total]
    );
  }

  /** Antrekan balasan; kembalikan null bila (reply_to_id, text) sudah pernah dipakai. */
  async enqueue(input: { id: string; replyToId: string; text: string; requestedBy: string | null }): Promise<ReplyQueueItem | null> {
    const result = await this.pool.query<ReplyRow>(
      `INSERT INTO reply_queue (id, reply_to_id, text, requested_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (reply_to_id, text) DO NOTHING
       RETURNING *`,
      [input.id, input.replyToId, input.text, input.requestedBy]
    );
    return result.rows[0] ? mapReply(result.rows[0]) : null;
  }

  async list(limit = 50): Promise<ReplyQueueItem[]> {
    const result = await this.pool.query<ReplyRow>('SELECT * FROM reply_queue ORDER BY created_at DESC LIMIT $1', [limit]);
    return result.rows.map(mapReply);
  }

  async get(id: string): Promise<ReplyQueueItem | null> {
    const result = await this.pool.query<ReplyRow>('SELECT * FROM reply_queue WHERE id = $1', [id]);
    return result.rows[0] ? mapReply(result.rows[0]) : null;
  }

  /** Klaim atomik: hanya satu worker yang boleh memanggil Meta untuk baris ini. */
  async claim(id: string): Promise<ReplyQueueItem | null> {
    const result = await this.pool.query<ReplyRow>(
      "UPDATE reply_queue SET status = 'CONTAINER_CREATED', attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1 AND status = 'QUEUED' RETURNING *",
      [id]
    );
    return result.rows[0] ? mapReply(result.rows[0]) : null;
  }

  async pending(limit = 50): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM reply_queue WHERE status IN ('QUEUED','CONTAINER_CREATED','NEEDS_REVIEW') ORDER BY created_at LIMIT $1",
      [limit]
    );
    return result.rows.map((row) => row.id);
  }

  async recordAttempt(input: { id: string; queueId: string; step: string; outcome: string; errorCode?: string | null; error?: string | null; containerId?: string | null; mediaId?: string | null }): Promise<void> {
    await this.pool.query(
      `INSERT INTO reply_attempts (id, queue_id, step, outcome, error_code, error, container_id, media_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.id, input.queueId, input.step, input.outcome, input.errorCode ?? null, input.error ?? null, input.containerId ?? null, input.mediaId ?? null]
    );
  }

  async markReplied(id: string, mediaId: string): Promise<void> {
    await this.pool.query("UPDATE reply_queue SET status = 'REPLIED', media_id = $2, updated_at = now() WHERE id = $1", [id, mediaId]);
  }

  async markNeedsReview(id: string, code: string, message: string): Promise<void> {
    await this.pool.query("UPDATE reply_queue SET status = 'NEEDS_REVIEW', last_error_code = $2, last_error = $3, updated_at = now() WHERE id = $1", [id, code, message]);
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    await this.pool.query("UPDATE reply_queue SET status = 'FAILED', last_error_code = $2, last_error = $3, updated_at = now() WHERE id = $1", [id, code, message]);
  }

  async markRequiresLive(id: string): Promise<void> {
    await this.pool.query("UPDATE reply_queue SET status = 'REQUIRES_LIVE', last_error_code = 'LIVE_DISABLED', last_error = 'Balasan live belum diaktifkan operator.', updated_at = now() WHERE id = $1", [id]);
  }

  async resolve(id: string, resolution: 'REPLIED' | 'FAILED'): Promise<void> {
    if (resolution === 'REPLIED') {
      const row = await this.get(id);
      await this.pool.query("UPDATE reply_queue SET status = 'REPLIED', media_id = COALESCE(media_id, $2), updated_at = now() WHERE id = $1 AND status = 'NEEDS_REVIEW'", [id, row?.mediaId ?? '']);
    } else {
      await this.pool.query("UPDATE reply_queue SET status = 'FAILED', updated_at = now() WHERE id = $1 AND status = 'NEEDS_REVIEW'", [id]);
    }
  }

  /** Balasan dibuat hari ini (WIB) — untuk menegakkan daily_limit. */
  async countToday(): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      "SELECT count(*) n FROM reply_queue WHERE created_at >= (now() AT TIME ZONE 'Asia/Jakarta')::date::timestamptz"
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}
