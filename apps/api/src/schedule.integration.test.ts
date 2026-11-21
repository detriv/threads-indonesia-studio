import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AuthRepository, DraftRepository, EditorialRepository, ScheduleRepository, hashPassword } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { buildApp } from './app.js';
import { adminLogin } from './testing.js';

let pool: pg.Pool;
let auth: AuthRepository;
let editorial: EditorialRepository;
let drafts: DraftRepository;
let schedule: ScheduleRepository;
let themeId: string;

function makeApp() {
  return buildApp({
    repo: { create: vi.fn(async () => undefined), get: vi.fn(async () => null), list: vi.fn(async () => []) },
    queue: { send: vi.fn(async () => 'job-1') },
    auth, editorial, drafts, schedule
  });
}

const TREND_SOURCES = { sourceUrl: 'https://example.com/tren', sourceTime: '2026-11-20T03:00:00.000Z', relevanceNote: 'Relate untuk usia 20-an' };
const DAY1 = '2026-11-22T02:00:00.000Z'; // 09:00 WIB 22 Nov
const DAY1_LATER = '2026-11-22T05:00:00.000Z';
const DAY2 = '2026-11-23T02:00:00.000Z';

async function makeDraft(format: 'OBSERVASI_PENDEK' | 'TREN_RELEVAN' = 'OBSERVASI_PENDEK', text = 'Draft uji jadwal.') {
  return drafts.create({ themeId, format, text, ...(format === 'TREN_RELEVAN' ? TREND_SOURCES : {}) });
}

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
  themeId = (await editorial.listThemes())[0]!.id;
});

describe('schedule API (PostgreSQL)', () => {
  it('menjadwalkan draft reguler: versi 1, outbox UPSERT, draft jadi SCHEDULED', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const draft = await makeDraft();
    const created = await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: draft.id, scheduledAt: DAY1 } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ draftId: draft.id, status: 'SCHEDULED', version: 1 });
    expect((await drafts.get(draft.id))?.status).toBe('SCHEDULED');
    const outbox = await pool.query('SELECT event, version, processed FROM schedule_outbox WHERE schedule_id = $1', [created.json().id]);
    expect(outbox.rows).toEqual([{ event: 'UPSERT', version: 1, processed: false }]);
    await app.close();
  });

  it('draft tren harus lewat review sebelum dijadwalkan', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const trend = await makeDraft('TREN_RELEVAN');
    const blocked = await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: trend.id, scheduledAt: DAY1 } });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toContain('review');
    await drafts.review(trend.id, 'APPROVE');
    const ok = await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: trend.id, scheduledAt: DAY1 } });
    expect(ok.statusCode).toBe(201);
    await app.close();
  });

  it('batas harian ditegakkan per hari Jakarta saat create dan reschedule', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    // default limit 2
    const d1 = await makeDraft('OBSERVASI_PENDEK', 'Draft 1.');
    const d2 = await makeDraft('OBSERVASI_PENDEK', 'Draft 2.');
    const d3 = await makeDraft('OBSERVASI_PENDEK', 'Draft 3.');
    expect((await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: d1.id, scheduledAt: DAY1 } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: d2.id, scheduledAt: DAY1_LATER } })).statusCode).toBe(201);
    const third = await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: d3.id, scheduledAt: DAY1_LATER } });
    expect(third.statusCode).toBe(400);
    expect(third.json().error).toMatch(/batas harian/i);
    // Hari lain masih bisa.
    expect((await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: d3.id, scheduledAt: DAY2 } })).statusCode).toBe(201);
    await app.close();
  });

  it('reschedule menaikkan versi dan mencatat outbox baru', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const draft = await makeDraft();
    const created = await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: draft.id, scheduledAt: DAY1 } });
    const id = created.json().id;
    const moved = await app.inject({ method: 'PATCH', url: `/api/schedule/${id}`, headers, payload: { scheduledAt: DAY2 } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ version: 2, status: 'SCHEDULED' });
    expect(moved.json().scheduledAt).toBe(DAY2);
    const outbox = await pool.query('SELECT event, version FROM schedule_outbox WHERE schedule_id = $1 ORDER BY created_at', [id]);
    expect(outbox.rows).toEqual([{ event: 'UPSERT', version: 1 }, { event: 'UPSERT', version: 2 }]);
    await app.close();
  });

  it('cancel mencegah eksekusi, mencatat outbox CANCEL + riwayat, dan mengembalikan status draft', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const draft = await makeDraft();
    const created = await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: draft.id, scheduledAt: DAY1 } });
    const id = created.json().id;
    const cancelled = await app.inject({ method: 'POST', url: `/api/schedule/${id}/cancel`, headers });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED', version: 2 });
    expect((await drafts.get(draft.id))?.status).toBe('DRAFT');
    const outbox = await pool.query('SELECT event, version FROM schedule_outbox WHERE schedule_id = $1 AND event = \'CANCEL\'', [id]);
    expect(outbox.rows).toEqual([{ event: 'CANCEL', version: 2 }]);
    const executions = await pool.query('SELECT status, version FROM schedule_executions WHERE schedule_id = $1', [id]);
    expect(executions.rows).toEqual([{ status: 'CANCELLED', version: 2 }]);
    // Reschedule jadwal yang sudah batal ditolak.
    expect((await app.inject({ method: 'PATCH', url: `/api/schedule/${id}`, headers, payload: { scheduledAt: DAY2 } })).statusCode).toBe(409);
    await app.close();
  });

  it('daftar jadwal (kalender daftar) bisa difilter dan rute dilindungi', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/schedule' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/schedule' })).statusCode).toBe(401);
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const d1 = await makeDraft('OBSERVASI_PENDEK', 'Jadwal satu.');
    const d2 = await makeDraft('OBSERVASI_PENDEK', 'Jadwal dua.');
    const s1 = await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: d1.id, scheduledAt: DAY1 } });
    await app.inject({ method: 'POST', url: '/api/schedule', headers, payload: { draftId: d2.id, scheduledAt: DAY2 } });
    await app.inject({ method: 'POST', url: `/api/schedule/${s1.json().id}/cancel`, headers });
    const all = (await app.inject({ method: 'GET', url: '/api/schedule', headers: { cookie } })).json();
    expect(all).toHaveLength(2);
    expect(all[0]).toHaveProperty('draftText');
    expect(all[0]).toHaveProperty('themeName');
    const active = (await app.inject({ method: 'GET', url: '/api/schedule?status=SCHEDULED', headers: { cookie } })).json();
    expect(active).toHaveLength(1);
    const day1 = (await app.inject({ method: 'GET', url: `/api/schedule?from=2026-11-22T00:00:00.000Z&to=2026-11-22T23:59:59.000Z`, headers: { cookie } })).json();
    expect(day1).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `/api/schedule/${s1.json().id}/cancel`, headers: { cookie } })).statusCode).toBe(403);
    await app.close();
  });
});
