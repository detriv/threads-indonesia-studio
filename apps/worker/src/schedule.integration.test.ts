import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';
import type pg from 'pg';
import { DraftRepository, EditorialRepository, ScheduleRepository } from '@threads-id/db';
import { resetTestDatabase, TEST_DATABASE_URL, truncateAll } from '@threads-id/db/testing';
import { SCHEDULE_JOB_NAME, scheduleJobDataSchema } from '@threads-id/contracts';
import { createSimulationAdapter, processScheduleJob } from './schedule-processor.js';
import { dispatchOutbox } from './dispatcher.js';

let pool: pg.Pool;
let editorial: EditorialRepository;
let drafts: DraftRepository;
let schedule: ScheduleRepository;
let themeId: string;
const adapter = createSimulationAdapter();

async function makeScheduledDraft(offsetMs = -2000) {
  const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Observasi uji worker: niat nabung malah checkout.' });
  const entry = await schedule.create(draft.id, new Date(Date.now() + offsetMs));
  return { draft, entry };
}

async function executionsFor(scheduleId: string) {
  const result = await pool.query('SELECT version, status, result FROM schedule_executions WHERE schedule_id = $1 ORDER BY version', [scheduleId]);
  return result.rows;
}

beforeAll(async () => {
  pool = await resetTestDatabase();
  editorial = new EditorialRepository(pool);
  drafts = new DraftRepository(pool);
  schedule = new ScheduleRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await editorial.seedDefaults();
  themeId = (await editorial.listThemes())[0]!.id;
});

describe('worker jadwal simulasi (PostgreSQL + pg-boss)', () => {
  it('dispatcher mengirim job dari outbox dan worker menyelesaikan simulasi end-to-end', async () => {
    const boss = new PgBoss({ connectionString: TEST_DATABASE_URL });
    await boss.start();
    await boss.createQueue(SCHEDULE_JOB_NAME);
    const { draft, entry } = await makeScheduledDraft();
    const dispatched = await dispatchOutbox(pool, boss);
    expect(dispatched).toBe(1);
    const outbox = await pool.query('SELECT processed FROM schedule_outbox WHERE schedule_id = $1', [entry.id]);
    expect(outbox.rows[0]?.processed).toBe(true);
    await boss.work(SCHEDULE_JOB_NAME, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        const outcome = await processScheduleJob(scheduleJobDataSchema.parse(job.data), schedule, adapter);
        if (outcome === 'DEFERRED_PAUSED') throw new Error('Jadwal dipause global');
      }
    });
    let execution: { status: string; result: Record<string, unknown> } | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const rows = await executionsFor(entry.id);
      execution = rows[0] as { status: string; result: Record<string, unknown> } | undefined;
      if (execution) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(execution?.status).toBe('SIMULATED_OK');
    expect(execution?.result).toMatchObject({ simulated: true, draftId: draft.id });
    expect(String(execution?.result?.externalId)).toMatch(/^sim-/);
    expect(String(execution?.result?.message)).toContain('Simulasi');
    const after = await schedule.get(entry.id);
    expect(after?.status).toBe('COMPLETED');
    // Siklus draft terpisah dari eksekusi: draft tetap SCHEDULED, hasil eksekusi tercatat sendiri.
    expect((await drafts.get(draft.id))?.status).toBe('SCHEDULED');
    await boss.stop();
  }, 30000);

  it('job versi lama (stale) setelah reschedule tidak menerapkan apa pun', async () => {
    const { entry } = await makeScheduledDraft();
    const moved = await schedule.reschedule(entry.id, new Date(Date.now() + 3600_000));
    expect(moved.version).toBe(2);
    const stale = await processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, adapter);
    expect(stale).toBe('SKIPPED_STALE');
    const rows = await executionsFor(entry.id);
    expect(rows).toEqual([{ version: 1, status: 'SKIPPED_STALE', result: null }]);
    expect((await schedule.get(entry.id))?.status).toBe('SCHEDULED');
    const current = await processScheduleJob({ scheduleId: entry.id, version: 2 }, schedule, adapter);
    expect(current).toBe('SIMULATED_OK');
  });

  it('edit tren terjadwal membatalkan versi aktif sampai disetujui dan dijadwalkan kembali', async () => {
    const draft = await drafts.create({ themeId, format: 'TREN_RELEVAN', text: 'Tren awal', sourceUrl: 'https://example.org/sumber', sourceTime: new Date().toISOString(), relevanceNote: 'Kaitan keseharian usia 20-an' });
    await drafts.review(draft.id, 'APPROVE');
    const entry = await schedule.create(draft.id, new Date());
    await drafts.update(draft.id, { text: 'Tren revisi belum disetujui' });
    expect((await drafts.get(draft.id))?.status).toBe('IN_REVIEW');
    expect((await schedule.get(entry.id))?.status).toBe('CANCELLED');
    expect(await processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, adapter)).not.toBe('SIMULATED_OK');
    await expect(schedule.create(draft.id, new Date())).rejects.toThrow(/review/);
    await drafts.review(draft.id, 'APPROVE');
    const replacement = await schedule.create(draft.id, new Date());
    expect(await processScheduleJob({ scheduleId: replacement.id, version: 1 }, schedule, adapter)).toBe('SIMULATED_OK');
    expect((await executionsFor(entry.id)).some((e) => e.status === 'SIMULATED_OK')).toBe(false);
  });

  it('completion atomik menolak review atau pause yang berubah setelah worker membaca', async () => {
    const { draft, entry } = await makeScheduledDraft();
    await processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, {
      async simulatePublication() {
        await drafts.update(draft.id, { format: 'TREN_RELEVAN' });
        return { simulated: true };
      }
    });
    expect((await executionsFor(entry.id)).some((e) => e.status === 'SIMULATED_OK')).toBe(false);
    const second = await makeScheduledDraft();
    await processScheduleJob({ scheduleId: second.entry.id, version: 1 }, schedule, {
      async simulatePublication() {
        await editorial.updateSettings({ ...(await editorial.getSettings()), paused: true });
        return { simulated: true };
      }
    });
    expect(await executionsFor(second.entry.id)).toHaveLength(0);
    expect((await schedule.get(second.entry.id))?.status).toBe('SCHEDULED');
  });

  it('edit reguler terjadwal mengganti versi atomik dan snapshot konten untuk job pengganti', async () => {
    const { draft, entry } = await makeScheduledDraft();
    const otherTheme = (await editorial.listThemes())[1]!;
    const outcome = await processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, {
      async simulatePublication() {
        await drafts.update(draft.id, { text: 'Teks pengganti', themeId: otherTheme.id, format: 'BAHASAN_LEBIH_DALAM' });
        return { simulated: true, text: draft.text };
      }
    });
    expect(outcome).not.toBe('SIMULATED_OK');
    const updated = (await schedule.get(entry.id))!;
    expect(updated).toMatchObject({ status: 'SCHEDULED', version: 2 });
    expect(await processScheduleJob({ scheduleId: entry.id, version: 2 }, schedule, adapter)).toBe('SIMULATED_OK');
    const history = await schedule.listExecutions({ status: 'SIMULATED_OK' });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ version: 2, draftText: 'Teks pengganti', themeId: otherTheme.id, themeName: otherTheme.name, format: 'BAHASAN_LEBIH_DALAM', snapshotProvenance: 'CAPTURED' });
  });

  it('job duplikat/konkuren hanya menghasilkan satu eksekusi', async () => {
    const { entry } = await makeScheduledDraft();
    const job = { scheduleId: entry.id, version: 1 };
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => processScheduleJob(job, schedule, adapter)));
    expect(outcomes.filter((o) => o === 'SIMULATED_OK')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'DUPLICATE')).toHaveLength(4);
    const rows = await executionsFor(entry.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SIMULATED_OK');
  });

  it('jadwal yang dibatalkan tidak pernah dieksekusi walau job lama datang', async () => {
    const { entry } = await makeScheduledDraft();
    await schedule.cancel(entry.id);
    const outcome = await processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, adapter);
    expect(['SKIPPED_STALE', 'SKIPPED_CANCELLED']).toContain(outcome);
    const rows = await executionsFor(entry.id);
    expect(rows.some((r) => r.status === 'SIMULATED_OK')).toBe(false);
    expect(rows.some((r) => r.status === 'CANCELLED')).toBe(true);
    expect((await schedule.get(entry.id))?.status).toBe('CANCELLED');
  });

  it('pause global menunda eksekusi tanpa mencatat hasil; unpause melanjutkan', async () => {
    const { entry } = await makeScheduledDraft();
    await editorial.updateSettings({ ...(await editorial.getSettings()), paused: true });
    const deferred = await processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, adapter);
    expect(deferred).toBe('DEFERRED_PAUSED');
    expect(await executionsFor(entry.id)).toHaveLength(0);
    expect((await schedule.get(entry.id))?.status).toBe('SCHEDULED');
    await editorial.updateSettings({ ...(await editorial.getSettings()), paused: false });
    expect(await processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, adapter)).toBe('SIMULATED_OK');
  });

  it('reservasi harian konkuren antar draft berbeda tidak melewati limit saat create', async () => {
    await editorial.updateSettings({ ...(await editorial.getSettings()), dailyPostLimit: 1 });
    const a = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'A' });
    const b = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'B' });
    await pool.query(`CREATE FUNCTION test_delay_schedule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$;
      CREATE TRIGGER test_delay BEFORE INSERT ON schedule_entries FOR EACH ROW EXECUTE FUNCTION test_delay_schedule()`);
    try {
      const outcomes = await Promise.allSettled([schedule.create(a.id, new Date('2026-12-01T16:59:00Z')), schedule.create(b.id, new Date('2026-12-01T01:00:00Z'))]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await schedule.list()).toHaveLength(1);
    } finally {
      await pool.query('DROP TRIGGER test_delay ON schedule_entries; DROP FUNCTION test_delay_schedule()');
    }
  });

  it('reservasi harian konkuren antar jadwal berbeda tidak melewati limit saat reschedule', async () => {
    await editorial.updateSettings({ ...(await editorial.getSettings()), dailyPostLimit: 1 });
    const a = await makeScheduledDraft();
    const bDraft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'B' });
    const b = await schedule.create(bDraft.id, new Date('2026-12-02T02:00:00Z'));
    await pool.query(`CREATE FUNCTION test_delay_schedule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$;
      CREATE TRIGGER test_delay BEFORE UPDATE ON schedule_entries FOR EACH ROW EXECUTE FUNCTION test_delay_schedule()`);
    try {
      const outcomes = await Promise.allSettled([schedule.reschedule(a.entry.id, new Date('2026-12-03T01:00:00Z')), schedule.reschedule(b.id, new Date('2026-12-03T16:59:00Z'))]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await schedule.list({ from: '2026-12-03T00:00:00Z', to: '2026-12-03T16:59:59Z' })).toHaveLength(1);
    } finally {
      await pool.query('DROP TRIGGER test_delay ON schedule_entries; DROP FUNCTION test_delay_schedule()');
    }
  });

  it('completion konkuren jadwal independen memakai limit terbaru setelah adapter mulai', async () => {
    const first = await makeScheduledDraft();
    const second = await makeScheduledDraft();
    let arrived = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const waitingAdapter = {
      async simulatePublication(draft: { id: string; text: string }) {
        arrived += 1;
        if (arrived === 2) {
          await editorial.updateSettings({ ...(await editorial.getSettings()), dailyPostLimit: 1 });
          release();
        }
        await ready;
        return { simulated: true, text: draft.text, draftId: draft.id };
      }
    };
    const outcomes = await Promise.all([first, second].map(({ entry }) => processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, waitingAdapter)));
    expect(outcomes.filter((o) => o === 'SIMULATED_OK')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'SKIPPED_LIMIT')).toHaveLength(1);
    expect(await schedule.countSimulatedOkForDay(new Date())).toBe(1);
    const entries = await schedule.list();
    expect(entries.filter((e) => e.status === 'COMPLETED')).toHaveLength(1);
    expect((await schedule.listExecutions({ status: 'SKIPPED_LIMIT' }))).toHaveLength(1);
  });

  it('batas harian ditegakkan worker: slot kedua pada hari yang sama di-skip', async () => {
    // Dua jadwal dibuat saat limit masih 2, lalu admin menurunkan limit ke 1.
    const first = await makeScheduledDraft();
    const second = await makeScheduledDraft();
    await editorial.updateSettings({ ...(await editorial.getSettings()), dailyPostLimit: 1 });
    expect(await processScheduleJob({ scheduleId: first.entry.id, version: 1 }, schedule, adapter)).toBe('SIMULATED_OK');
    expect(await processScheduleJob({ scheduleId: second.entry.id, version: 1 }, schedule, adapter)).toBe('SKIPPED_LIMIT');
    const rows = await executionsFor(second.entry.id);
    expect(rows[0]?.status).toBe('SKIPPED_LIMIT');
    expect((await schedule.get(second.entry.id))?.status).toBe('SCHEDULED');
  });

  it('outbox CANCEL tidak mengirim job publikasi; job lama direkonsiliasi sebagai stale', async () => {
    const boss = new PgBoss({ connectionString: TEST_DATABASE_URL });
    await boss.start();
    await boss.createQueue(SCHEDULE_JOB_NAME);
    const { entry } = await makeScheduledDraft();
    await schedule.cancel(entry.id); // outbox: UPSERT v1 (belum diproses) + CANCEL v2
    await dispatchOutbox(pool, boss);
    const outbox = await pool.query('SELECT event, processed FROM schedule_outbox WHERE schedule_id = $1 ORDER BY created_at', [entry.id]);
    expect(outbox.rows.every((r) => r.processed)).toBe(true);
    const jobs = await pool.query('SELECT data FROM pgboss.job WHERE name = $1 AND data->>\'scheduleId\' = $2', [SCHEDULE_JOB_NAME, entry.id]);
    expect(jobs.rows).toHaveLength(1); // hanya UPSERT v1; CANCEL tidak menghasilkan job
    expect(jobs.rows[0]?.data).toMatchObject({ scheduleId: entry.id, version: 1 });
    const outcome = await processScheduleJob({ scheduleId: entry.id, version: 1 }, schedule, adapter);
    expect(['SKIPPED_STALE', 'SKIPPED_CANCELLED']).toContain(outcome);
    expect((await executionsFor(entry.id)).some((r) => r.status === 'SIMULATED_OK')).toBe(false);
    await boss.stop();
  }, 30000);
});
