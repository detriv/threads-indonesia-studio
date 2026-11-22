import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AuthRepository, DraftRepository, EditorialRepository, ScheduleRepository, hashPassword } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { buildApp } from './app.js';
import { applyMigrations } from '@threads-id/db/migrate';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { adminLogin } from './testing.js';

let pool: pg.Pool;
let auth: AuthRepository;
let editorial: EditorialRepository;
let drafts: DraftRepository;
let schedule: ScheduleRepository;
let themeA: string;
let themeB: string;

function makeApp() {
  return buildApp({
    repo: { create: vi.fn(async () => undefined), get: vi.fn(async () => null), list: vi.fn(async () => []) },
    queue: { send: vi.fn(async () => 'job-1') },
    auth, editorial, drafts, schedule
  });
}

const SIM_RESULT = { simulated: true, demo: true, externalId: 'sim-test-1', message: 'Simulasi publikasi teks. Tidak ada post nyata.' };

beforeAll(async () => {
  pool = await resetTestDatabase();
  auth = new AuthRepository(pool);
  editorial = new EditorialRepository(pool);
  drafts = new DraftRepository(pool);
  schedule = new ScheduleRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await auth.ensureAdmin('admin', await hashPassword('password-lokal-yang-kuat'));
  await editorial.seedDefaults();
  const themes = await editorial.listThemes();
  themeA = themes[0]!.id;
  themeB = themes[1]!.id;
});

async function seedHistory() {
  // 1 eksekusi simulasi sukses (tema A, observasi), 1 batal (tema B), 1 stale (tema A, bahasan).
  const d1 = await drafts.create({ themeId: themeA, format: 'OBSERVASI_PENDEK', text: 'Riwayat sukses.' });
  const s1 = await schedule.create(d1.id, new Date('2026-11-22T02:00:00.000Z'));
  await schedule.completeSimulation(s1.id, 1, SIM_RESULT);
  const d2 = await drafts.create({ themeId: themeB, format: 'OBSERVASI_PENDEK', text: 'Riwayat batal.' });
  const s2 = await schedule.create(d2.id, new Date('2026-11-22T05:00:00.000Z'));
  await schedule.cancel(s2.id);
  const d3 = await drafts.create({ themeId: themeA, format: 'BAHASAN_LEBIH_DALAM', text: 'Riwayat stale.' });
  const s3 = await schedule.create(d3.id, new Date('2026-11-23T02:00:00.000Z'));
  await schedule.reschedule(s3.id, new Date('2026-11-23T04:00:00.000Z'));
  await schedule.recordSkip(s3.id, 1, 'SKIPPED_STALE');
  return { s1, s2, s3 };
}

describe('riwayat + status integrasi (PostgreSQL)', () => {
  it('riwayat memuat payload domain lengkap, bukan sekadar status', async () => {
    await seedHistory();
    const app = makeApp();
    const { cookie } = await adminLogin(app);
    const history = (await app.inject({ method: 'GET', url: '/api/history', headers: { cookie } })).json();
    expect(history).toHaveLength(3);
    const ok = history.find((h: { status: string }) => h.status === 'SIMULATED_OK');
    expect(ok).toMatchObject({ themeName: 'Pertemanan dan chat', format: 'OBSERVASI_PENDEK', draftText: 'Riwayat sukses.', draftStatus: 'SCHEDULED', version: 1, demo: true });
    expect(ok.result).toMatchObject({ simulated: true, externalId: 'sim-test-1' });
    expect(ok.scheduledAt).toBe('2026-11-22T02:00:00.000Z');
    expect(ok.executedAt).toBeTruthy();
    expect(history.some((h: { status: string }) => h.status === 'CANCELLED')).toBe(true);
    expect(history.some((h: { status: string }) => h.status === 'SKIPPED_STALE')).toBe(true);
    await app.close();
  });

  it('riwayat sukses immutable setelah teks, tema, format dan nama tema diedit', async () => {
    const draft = await drafts.create({ themeId: themeA, format: 'OBSERVASI_PENDEK', text: 'Teks yang disimulasikan' });
    const entry = await schedule.create(draft.id, new Date('2026-12-01T02:00:00Z'));
    await schedule.completeSimulation(entry.id, 1, { ...SIM_RESULT, text: draft.text });
    const before = (await schedule.listExecutions())[0];
    await drafts.update(draft.id, { text: 'Teks baru', themeId: themeB, format: 'BAHASAN_LEBIH_DALAM' });
    await editorial.updateTheme(themeA, { name: 'Nama tema diubah' });
    expect((await schedule.listExecutions())[0]).toEqual(before);
    const app = makeApp();
    const { cookie } = await adminLogin(app);
    const result = await app.inject({ method: 'GET', url: `/api/history?themeId=${themeA}&format=OBSERVASI_PENDEK&from=2026-12-01T00:00:00Z&to=2026-12-01T16:59:59Z`, headers: { cookie } });
    expect(result.json()).toHaveLength(1);
    expect(result.json()[0]).toMatchObject({ draftText: 'Teks yang disimulasikan', themeId: themeA, themeName: 'Pertemanan dan chat', format: 'OBSERVASI_PENDEK', scheduledAt: entry.scheduledAt });
    expect(await schedule.listExecutions({ themeId: themeB })).toHaveLength(0);
    await app.close();
  });

  it('riwayat stale menyimpan waktu dan metadata versi lama setelah reschedule dan edit', async () => {
    const draft = await drafts.create({ themeId: themeA, format: 'OBSERVASI_PENDEK', text: 'Versi jadwal pertama' });
    const entry = await schedule.create(draft.id, new Date('2026-12-01T16:59:00Z'));
    await schedule.reschedule(entry.id, new Date('2026-12-02T17:01:00Z'));
    await drafts.update(draft.id, { text: 'Revisi sesudah reschedule', themeId: themeB });
    await schedule.recordSkip(entry.id, 1, 'SKIPPED_STALE');
    const rows = await schedule.listExecutions({ from: '2026-12-01T00:00:00Z', to: '2026-12-01T16:59:59Z', themeId: themeA });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, scheduledAt: entry.scheduledAt, draftText: draft.text, themeId: themeA });
  });

  it('migrasi merekonsiliasi jadwal legacy IN_REVIEW secara idempoten', async () => {
    const draft = await drafts.create({ themeId: themeA, format: 'OBSERVASI_PENDEK', text: 'Legacy edited trend' });
    const entry = await schedule.create(draft.id, new Date('2026-12-01T02:00:00Z'));
    await pool.query("UPDATE drafts SET format = 'TREN_RELEVAN', status = 'IN_REVIEW' WHERE id = $1", [draft.id]);
    // Defense at atomic completion cannot rely on edit-side invalidation alone.
    expect(await schedule.completeSimulation(entry.id, 1, SIM_RESULT)).not.toBe('SIMULATED_OK');
    await applyMigrations(pool);
    expect(await schedule.get(entry.id)).toMatchObject({ status: 'CANCELLED', version: 2 });
    expect((await schedule.listExecutions({ status: 'CANCELLED' }))).toHaveLength(1);
    const before = await schedule.listExecutions();
    await applyMigrations(pool);
    expect(await schedule.listExecutions()).toEqual(before);
    expect((await pool.query("SELECT * FROM schedule_outbox WHERE schedule_id = $1 AND event = 'CANCEL'", [entry.id])).rows).toHaveLength(1);
  });

  it('backfill legacy memakai bukti result/outbox saja dan tidak mengarang atribusi', async () => {
    // Emulate an upgrade from schema 002, with two old executions and an edited draft.
    await pool.query('DROP TRIGGER execution_snapshot ON schedule_executions; DROP TRIGGER schedule_version_snapshot ON schedule_entries');
    try {
      const draft = await drafts.create({ themeId: themeA, format: 'OBSERVASI_PENDEK', text: 'Teks kini bukan bukti historis' });
      const entry = await schedule.create(draft.id, new Date('2026-12-01T02:00:00Z'));
      await schedule.reschedule(entry.id, new Date('2026-12-02T02:00:00Z'));
      await pool.query("INSERT INTO schedule_executions (id, schedule_id, version, status, result) VALUES ($1, $2, 1, 'SIMULATED_OK', $3), ($4, $2, 99, 'SKIPPED_STALE', NULL)", [randomUUID(), entry.id, JSON.stringify({ text: 'Teks dari hasil lama', format: 'BAHASAN_LEBIH_DALAM', themeName: 'Tema historis dari result' }), randomUUID()]);
      await applyMigrations(pool);
      const old = (await schedule.listExecutions({ status: 'SIMULATED_OK' }))[0]!;
      expect(old).toMatchObject({ draftText: 'Teks dari hasil lama', format: 'BAHASAN_LEBIH_DALAM', themeName: 'Tema historis dari result', themeId: null, draftStatus: null, snapshotProvenance: 'LEGACY_PARTIAL', scheduledAt: '2026-12-01T02:00:00.000Z' });
      const unknown = (await schedule.listExecutions({ status: 'SKIPPED_STALE' }))[0]!;
      expect(unknown).toMatchObject({ draftText: null, themeId: null, themeName: null, format: null, scheduledAt: null, snapshotProvenance: 'LEGACY_PARTIAL' });
      const before = await schedule.listExecutions();
      await drafts.update(draft.id, { text: 'Revisi lagi', themeId: themeB });
      await applyMigrations(pool);
      expect(await schedule.listExecutions()).toEqual(before);
      expect(await schedule.listExecutions({ themeId: themeA })).toHaveLength(0);
    } finally {
      // Even an assertion failure must leave triggers installed for later tests.
      await pool.query(await readFile(new URL('../../../packages/db/migrations/003_history_snapshots.sql', import.meta.url), 'utf8'));
    }
  });

  it('filter riwayat: status, tema, format, dan rentang waktu', async () => {
    await seedHistory();
    const app = makeApp();
    const { cookie } = await adminLogin(app);
    const get = async (query: string) => (await app.inject({ method: 'GET', url: `/api/history?${query}`, headers: { cookie } })).json();
    expect(await get('status=SIMULATED_OK')).toHaveLength(1);
    expect(await get('status=CANCELLED')).toHaveLength(1);
    expect(await get(`themeId=${themeB}`)).toHaveLength(1);
    expect(await get(`themeId=${themeA}`)).toHaveLength(2);
    expect(await get('format=BAHASAN_LEBIH_DALAM')).toHaveLength(1);
    expect(await get('from=2026-11-23T00:00:00.000Z&to=2026-11-23T23:59:59.000Z')).toHaveLength(1);
    expect(await get(`status=SIMULATED_OK&themeId=${themeA}&format=OBSERVASI_PENDEK`)).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/history?status=BOGUS', headers: { cookie } })).statusCode).toBe(400);
    await app.close();
  });

  it('status integrasi jujur: semua belum terhubung, mode simulasi, tanpa posting live', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/integrations' })).statusCode).toBe(401);
    const { cookie } = await adminLogin(app);
    const body = (await app.inject({ method: 'GET', url: '/api/integrations', headers: { cookie } })).json();
    expect(body).toMatchObject({ mode: 'SIMULASI', livePosting: false });
    expect(body.integrations).toHaveLength(2);
    for (const integration of body.integrations) {
      expect(integration.connected).toBe(false);
      expect(['SIMULASI', 'BELUM_TERHUBUNG', 'BELUM_LIVE']).toContain(integration.mode);
      expect(integration.note.length).toBeGreaterThan(10);
    }
    expect(body.integrations.map((i: { id: string }) => i.id)).toEqual(['meta-threads', 'gemini']);
    expect(body.integrations[1].note).toContain('Provider generasi');
    expect(body.integrations[1].note).not.toContain('cakupan Phase 2');
    expect(body.integrations[0].mode).toBe('BELUM_LIVE');
    await app.close();
  });

  it('matriks otorisasi: semua rute terlindungi 401 tanpa session; mutasi 403 tanpa CSRF', async () => {
    const app = makeApp();
    const id = '00000000-0000-4000-8000-000000000000';
    const gets = [
      '/api/demo/actions', `/api/demo/actions/${id}`, '/api/themes', '/api/settings',
      '/api/voice-examples', '/api/personal-sources', '/api/review-topics',
      '/api/drafts', `/api/drafts/${id}`, '/api/review', '/api/schedule', `/api/schedule/${id}`,
      '/api/history', '/api/integrations'
    ];
    const mutations: Array<[string, string]> = [
      ['POST', '/api/demo/actions'], ['POST', '/api/auth/logout'],
      ['POST', '/api/themes'], ['PATCH', `/api/themes/${id}`], ['PUT', '/api/themes/weights'],
      ['PATCH', '/api/settings'],
      ['POST', '/api/voice-examples'], ['DELETE', `/api/voice-examples/${id}`],
      ['POST', '/api/personal-sources'], ['DELETE', `/api/personal-sources/${id}`],
      ['POST', '/api/review-topics'], ['PATCH', `/api/review-topics/${id}`],
      ['POST', '/api/drafts'], ['PATCH', `/api/drafts/${id}`], ['POST', `/api/drafts/${id}/lock`],
      ['POST', `/api/drafts/${id}/review`], ['POST', `/api/drafts/${id}/cancel`],
      ['POST', '/api/schedule'], ['PATCH', `/api/schedule/${id}`], ['POST', `/api/schedule/${id}/cancel`]
    ];
    for (const url of gets) {
      expect((await app.inject({ method: 'GET', url })).statusCode, `GET ${url}`).toBe(401);
    }
    for (const [method, url] of mutations) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
    const { cookie } = await adminLogin(app);
    for (const [method, url] of mutations) {
      expect((await app.inject({ method, url, headers: { cookie } })).statusCode, `${method} ${url} tanpa CSRF`).toBe(403);
    }
    await app.close();
  });
});
