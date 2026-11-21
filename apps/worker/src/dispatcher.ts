import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { SCHEDULE_JOB_NAME } from '@threads-id/contracts';

type OutboxRow = { id: string; schedule_id: string; version: number; event: 'UPSERT' | 'CANCEL'; scheduled_at: Date | null };

/**
 * Dispatcher transactional outbox: membaca event jadwal yang belum diproses
 * (FOR UPDATE SKIP LOCKED) dan merekonsiliasi ke pg-boss.
 * - UPSERT: kirim job {scheduleId, version} dengan startAfter sesuai jadwal;
 *   singletonKey per versi mencegah duplikat job aktif.
 * - CANCEL: tidak mengirim job; worker menolak job lama lewat cek versi/status.
 * Job lama yang terlanjur mengantre tetap aman karena worker memverifikasi versi.
 */
export async function dispatchOutbox(pool: pg.Pool, boss: PgBoss, now = Date.now()): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pending = await client.query<OutboxRow>('SELECT * FROM schedule_outbox WHERE processed = false ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED');
    for (const row of pending.rows) {
      if (row.event === 'UPSERT' && row.scheduled_at) {
        const startAfter = Math.max(0, Math.ceil((row.scheduled_at.getTime() - now) / 1000));
        await boss.send(
          SCHEDULE_JOB_NAME,
          { scheduleId: row.schedule_id, version: row.version },
          { startAfter, singletonKey: `${row.schedule_id}:${row.version}`, retryLimit: 20, retryDelay: 30, retryBackoff: true }
        );
      }
      await client.query('UPDATE schedule_outbox SET processed = true WHERE id = $1', [row.id]);
    }
    await client.query('COMMIT');
    return pending.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
