import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AuthRepository, DraftRepository, EditorialRepository, hashPassword } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { buildApp } from './app.js';
import { adminLogin } from './testing.js';

let pool: pg.Pool;
let auth: AuthRepository;
let editorial: EditorialRepository;
let drafts: DraftRepository;
let themeId: string;
let sourceId: string;

function makeApp() {
  return buildApp({
    repo: { create: vi.fn(async () => undefined), get: vi.fn(async () => null), list: vi.fn(async () => []) },
    queue: { send: vi.fn(async () => 'job-1') },
    auth, editorial, drafts
  });
}

const TREND_SOURCES = { sourceUrl: 'https://example.com/tren-20an', sourceTime: '2026-11-20T03:00:00.000Z', relevanceNote: 'Relate buat anak kos yang suka begadang' };

beforeAll(async () => {
  pool = await resetTestDatabase();
  auth = new AuthRepository(pool);
  editorial = new EditorialRepository(pool);
  drafts = new DraftRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await auth.ensureAdmin('admin', await hashPassword('password-lokal-yang-kuat'));
  await editorial.seedDefaults();
  const themes = await editorial.listThemes();
  themeId = themes[0]!.id;
  sourceId = (await editorial.addPersonalSource('Catatan pemilik: dulu sering lupa jam karena scroll.')).id;
});

describe('draft API (PostgreSQL)', () => {
  it('membuat draft reguler berstatus DRAFT dan menolak input tidak valid', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const created = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'OBSERVASI_PENDEK', text: 'Temen yang cuma muncul kalau ada gratisan.' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'DRAFT', locked: false, format: 'OBSERVASI_PENDEK', version: 1 });
    expect((await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'OBSERVASI_PENDEK', text: '  ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId: '00000000-0000-4000-8000-000000000000', format: 'OBSERVASI_PENDEK', text: 'x' } })).statusCode).toBe(400);
    // Pengalaman pribadi hanya dari catatan pemilik yang ada.
    const withSource = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'OBSERVASI_PENDEK', text: 'Dari pengalaman pemilik.', personalSourceId: sourceId } });
    expect(withSource.statusCode).toBe(201);
    expect(withSource.json().personalSourceId).toBe(sourceId);
    expect((await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'OBSERVASI_PENDEK', text: 'x', personalSourceId: '00000000-0000-4000-8000-000000000000' } })).statusCode).toBe(400);
    await app.close();
  });

  it('draft tren wajib sumber memadai, selalu masuk review, dan tampil di antrean review', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    expect((await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'TREN_RELEVAN', text: 'Tren tanpa sumber.' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'TREN_RELEVAN', text: 'Tren setengah sumber.', sourceUrl: 'https://example.com/x' } })).statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'TREN_RELEVAN', text: 'Tren dengan sumber lengkap.', ...TREND_SOURCES } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'IN_REVIEW', format: 'TREN_RELEVAN' });
    expect(created.json().sourceUrl).toBe(TREND_SOURCES.sourceUrl);
    const queue = (await app.inject({ method: 'GET', url: '/api/review', headers: { cookie } })).json();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(created.json().id);
    await app.close();
  });

  it('edit draft tersimpan dan versi naik; draft terkunci ditolak server-side', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const created = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'OBSERVASI_PENDEK', text: 'Versi awal.' } });
    const id = created.json().id;
    const edited = await app.inject({ method: 'PATCH', url: `/api/drafts/${id}`, headers, payload: { text: 'Versi kedua.' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ text: 'Versi kedua.', version: 2 });
    const lock = await app.inject({ method: 'POST', url: `/api/drafts/${id}/lock`, headers, payload: { locked: true } });
    expect(lock.statusCode).toBe(200);
    expect(lock.json().locked).toBe(true);
    const blocked = await app.inject({ method: 'PATCH', url: `/api/drafts/${id}`, headers, payload: { text: 'Coba ubah saat terkunci.' } });
    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().error).toContain('terkunci');
    // Bahkan lewat repository langsung, edit draft terkunci ditolak.
    await expect(drafts.update(id, { text: 'Lewat repo langsung.' })).rejects.toThrow(/terkunci/i);
    const unlock = await app.inject({ method: 'POST', url: `/api/drafts/${id}/lock`, headers, payload: { locked: false } });
    expect(unlock.statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/drafts/${id}`, headers, payload: { text: 'Setelah unlock.' } })).statusCode).toBe(200);
    await app.close();
  });

  it('review: setujui/tolak tren, dan tren yang diedit kembali ke review', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const created = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'TREN_RELEVAN', text: 'Tren siap review.', ...TREND_SOURCES } });
    const id = created.json().id;
    // Belum bisa disetujui sebelum lewat review? Approve adalah aksi review itu sendiri.
    const approved = await app.inject({ method: 'POST', url: `/api/drafts/${id}/review`, headers, payload: { decision: 'APPROVE', note: 'Sumber jelas, relate.' } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('APPROVED');
    // Review ulang draft yang bukan IN_REVIEW ditolak.
    expect((await app.inject({ method: 'POST', url: `/api/drafts/${id}/review`, headers, payload: { decision: 'APPROVE' } })).statusCode).toBe(400);
    // Edit tren yang sudah approved mengembalikannya ke review.
    const edited = await app.inject({ method: 'PATCH', url: `/api/drafts/${id}`, headers, payload: { text: 'Tren direvisi.' } });
    expect(edited.json().status).toBe('IN_REVIEW');
    const rejected = await app.inject({ method: 'POST', url: `/api/drafts/${id}/review`, headers, payload: { decision: 'REJECT', note: 'Kurang nyambung dengan audiens.' } });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'DRAFT', reviewNote: 'Kurang nyambung dengan audiens.' });
    // Tren tanpa sumber memadai tidak bisa disetujui.
    const noSource = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'TREN_RELEVAN', text: 'Sumber akan dihapus.', ...TREND_SOURCES } });
    const nsId = noSource.json().id;
    await app.inject({ method: 'PATCH', url: `/api/drafts/${nsId}`, headers, payload: { sourceUrl: null } });
    expect((await app.inject({ method: 'POST', url: `/api/drafts/${nsId}/review`, headers, payload: { decision: 'APPROVE' } })).statusCode).toBe(400);
    await app.close();
  });

  it('filter daftar draft, pembatalan, dan proteksi rute', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/drafts' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/drafts' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/review' })).statusCode).toBe(401);
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const a = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'OBSERVASI_PENDEK', text: 'Draft A.' } });
    await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: { themeId, format: 'TREN_RELEVAN', text: 'Draft B.', ...TREND_SOURCES } });
    expect((await app.inject({ method: 'GET', url: '/api/drafts?status=IN_REVIEW', headers: { cookie } })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/drafts?format=OBSERVASI_PENDEK', headers: { cookie } })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/api/drafts?themeId=${themeId}`, headers: { cookie } })).json()).toHaveLength(2);
    // Tanpa CSRF, mutasi ditolak.
    expect((await app.inject({ method: 'PATCH', url: `/api/drafts/${a.json().id}`, headers: { cookie }, payload: { text: 'x' } })).statusCode).toBe(403);
    const cancelled = await app.inject({ method: 'POST', url: `/api/drafts/${a.json().id}/cancel`, headers });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('CANCELLED');
    expect((await app.inject({ method: 'PATCH', url: `/api/drafts/${a.json().id}`, headers, payload: { text: 'x' } })).statusCode).toBe(409);
    await app.close();
  });
});
