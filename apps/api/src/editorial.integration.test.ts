import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AuthRepository, EditorialRepository, hashPassword } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { PRESET_THEMES } from '@threads-id/contracts';
import { buildApp } from './app.js';
import { adminLogin } from './testing.js';

let pool: pg.Pool;
let auth: AuthRepository;
let editorial: EditorialRepository;

function makeApp() {
  return buildApp({
    repo: { create: vi.fn(async () => undefined), get: vi.fn(async () => null), list: vi.fn(async () => []) },
    queue: { send: vi.fn(async () => 'job-1') },
    auth,
    editorial
  });
}

beforeAll(async () => {
  pool = await resetTestDatabase();
  auth = new AuthRepository(pool);
  editorial = new EditorialRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await auth.ensureAdmin('admin', await hashPassword('password-lokal-yang-kuat'));
  await editorial.seedDefaults();
});

describe('editorial config API (PostgreSQL)', () => {
  it('preset empat tema + pengaturan default 70/20/10 tersedia setelah login', async () => {
    const app = makeApp();
    const { cookie } = await adminLogin(app);
    const themes = (await app.inject({ method: 'GET', url: '/api/themes', headers: { cookie } })).json();
    expect(themes).toHaveLength(4);
    expect(themes.map((t: { name: string }) => t.name)).toEqual(PRESET_THEMES.map((t) => t.name));
    expect(themes.reduce((s: number, t: { weight: number }) => s + t.weight, 0)).toBe(100);
    const pertemanan = themes.find((t: { name: string }) => t.name === 'Pertemanan dan chat');
    expect(pertemanan.examples[0]).toContain('gak pernah chat duluan');
    expect(pertemanan.role).toBe('UTAMA');
    const settings = (await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })).json();
    expect(settings).toMatchObject({ formatMix: { OBSERVASI_PENDEK: 70, BAHASAN_LEBIH_DALAM: 20, TREN_RELEVAN: 10 }, dailyPostLimit: 2, paused: false });
    await app.close();
  });

  it('semua rute editorial menolak akses tanpa session', async () => {
    const app = makeApp();
    const routes: Array<[string, string]> = [
      ['GET', '/api/themes'], ['POST', '/api/themes'], ['PUT', '/api/themes/weights'],
      ['GET', '/api/settings'], ['PATCH', '/api/settings'],
      ['GET', '/api/voice-examples'], ['POST', '/api/voice-examples'],
      ['GET', '/api/personal-sources'], ['POST', '/api/personal-sources'],
      ['GET', '/api/review-topics'], ['POST', '/api/review-topics']
    ];
    for (const [method, url] of routes) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
    await app.close();
  });

  it('admin bisa membuat tema baru dengan bobot seimbang dan contoh tulisan', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const created = await app.inject({
      method: 'POST', url: '/api/themes', headers,
      payload: { name: 'Kehidupan kos', role: 'SELINGAN', weight: 0, examples: ['Anak kos hafal suara tangga kosan.'] }
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body).toMatchObject({ name: 'Kehidupan kos', role: 'SELINGAN', weight: 0 });
    // Bobot total harus tetap 100: preset 100 + 20 ditolak kecuali diseimbangkan.
    const unbalanced = await app.inject({ method: 'POST', url: '/api/themes', headers, payload: { name: 'Tema lain', role: 'UTAMA', weight: 20, examples: ['x'] } });
    expect(unbalanced.statusCode).toBe(400);
    // Nama duplikat ditolak.
    const dup = await app.inject({ method: 'POST', url: '/api/themes', headers, payload: { name: 'Kehidupan kos', role: 'UTAMA', weight: 0, examples: ['x'] } });
    expect(dup.statusCode).toBe(409);
    // Validasi peran.
    const badRole = await app.inject({ method: 'POST', url: '/api/themes', headers, payload: { name: 'Tema salah', role: 'LAIN', weight: 0, examples: ['x'] } });
    expect(badRole.statusCode).toBe(400);
    // Persisted: app baru pada pool yang sama melihat tema tersebut.
    const app2 = makeApp();
    const { cookie: c2 } = await adminLogin(app2);
    const list = (await app2.inject({ method: 'GET', url: '/api/themes', headers: { cookie: c2 } })).json();
    expect(list.some((t: { name: string }) => t.name === 'Kehidupan kos')).toBe(true);
    await app.close(); await app2.close();
  });

  it('bobot tema bisa diedit massal dan wajib berjumlah 100', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const themes = (await app.inject({ method: 'GET', url: '/api/themes', headers: { cookie } })).json();
    const weights = themes.map((t: { id: string; weight: number }, i: number) => ({ id: t.id, weight: i === 0 ? 40 : t.weight - (i === 1 ? 10 : 0) }));
    const ok = await app.inject({ method: 'PUT', url: '/api/themes/weights', headers, payload: { weights } });
    expect(ok.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/api/themes', headers: { cookie } })).json();
    expect(after.find((t: { id: string }) => t.id === themes[0].id).weight).toBe(40);
    expect(after.reduce((s: number, t: { weight: number }) => s + t.weight, 0)).toBe(100);
    const bad = await app.inject({ method: 'PUT', url: '/api/themes/weights', headers, payload: { weights: themes.map((t: { id: string }) => ({ id: t.id, weight: 50 })) } });
    expect(bad.statusCode).toBe(400);
    const unchanged = (await app.inject({ method: 'GET', url: '/api/themes', headers: { cookie } })).json();
    expect(unchanged.find((t: { id: string }) => t.id === themes[0].id).weight).toBe(40);
    // Tanpa CSRF ditolak.
    expect((await app.inject({ method: 'PUT', url: '/api/themes/weights', headers: { cookie }, payload: { weights } })).statusCode).toBe(403);
    await app.close();
  });

  it('editor bobot menolak daftar yang tidak mencakup tepat satu entri per tema', async () => {
    const app = makeApp();
    try {
      const { cookie, csrf } = await adminLogin(app);
      const [first] = await editorial.listThemes();
      const headers = { cookie, 'x-csrf-token': csrf };
      const res = await app.inject({ method: 'PUT', url: '/api/themes/weights', headers,
        payload: { weights: [{ id: first!.id, weight: 100 }] } });
      expect(res.statusCode).toBe(400);
      expect((await editorial.listThemes()).map((theme) => theme.weight)).toEqual([30, 30, 30, 10]);
    } finally { await app.close(); }
  });

  it('edit tema: nama, contoh, dan status aktif tersimpan', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const themes = (await app.inject({ method: 'GET', url: '/api/themes', headers: { cookie } })).json();
    const target = themes[3];
    const patched = await app.inject({ method: 'PATCH', url: `/api/themes/${target.id}`, headers, payload: { name: 'Uang dan jajan (selingan)', active: false, examples: ['Contoh baru satu.', 'Contoh baru dua.'] } });
    expect(patched.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/api/themes', headers: { cookie } })).json();
    const updated = after.find((t: { id: string }) => t.id === target.id);
    expect(updated).toMatchObject({ name: 'Uang dan jajan (selingan)', active: false });
    expect(updated.examples).toEqual(['Contoh baru satu.', 'Contoh baru dua.']);
    await app.close();
  });

  it('pengaturan format, batas harian, dan pause bisa diedit dengan validasi', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const ok = await app.inject({ method: 'PATCH', url: '/api/settings', headers, payload: { formatMix: { OBSERVASI_PENDEK: 60, BAHASAN_LEBIH_DALAM: 30, TREN_RELEVAN: 10 }, dailyPostLimit: 3, paused: true } });
    expect(ok.statusCode).toBe(200);
    const settings = (await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })).json();
    expect(settings).toMatchObject({ formatMix: { OBSERVASI_PENDEK: 60, BAHASAN_LEBIH_DALAM: 30, TREN_RELEVAN: 10 }, dailyPostLimit: 3, paused: true });
    expect((await app.inject({ method: 'PATCH', url: '/api/settings', headers, payload: { formatMix: { OBSERVASI_PENDEK: 50, BAHASAN_LEBIH_DALAM: 30, TREN_RELEVAN: 10 } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/settings', headers, payload: { dailyPostLimit: 0 } })).statusCode).toBe(400);
    await app.close();
  });

  it('contoh suara akun, sumber pengalaman pribadi, dan topik review CRUD persisted', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const voice = await app.inject({ method: 'POST', url: '/api/voice-examples', headers, payload: { text: 'Aku pakai "gue" kalau lagi santai, "aku" kalau cerita serius.' } });
    expect(voice.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/api/voice-examples', headers: { cookie } })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: '/api/voice-examples', headers, payload: { text: '  ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/voice-examples/${voice.json().id}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/voice-examples', headers: { cookie } })).json()).toHaveLength(0);

    const source = await app.inject({ method: 'POST', url: '/api/personal-sources', headers, payload: { note: 'Pengalaman pemilik: pernah lupa jam karena baca debat telur.' } });
    expect(source.statusCode).toBe(201);
    const sources = (await app.inject({ method: 'GET', url: '/api/personal-sources', headers: { cookie } })).json();
    expect(sources[0].note).toContain('debat telur');
    expect((await app.inject({ method: 'POST', url: '/api/personal-sources', headers, payload: { note: '' } })).statusCode).toBe(400);

    const topic = await app.inject({ method: 'POST', url: '/api/review-topics', headers, payload: { topic: 'Apakah gaya bahasa sudah cukup santai?' } });
    expect(topic.statusCode).toBe(201);
    const resolved = await app.inject({ method: 'PATCH', url: `/api/review-topics/${topic.json().id}`, headers, payload: { status: 'RESOLVED' } });
    expect(resolved.statusCode).toBe(200);
    const topics = (await app.inject({ method: 'GET', url: '/api/review-topics', headers: { cookie } })).json();
    expect(topics[0]).toMatchObject({ status: 'RESOLVED' });
    expect((await app.inject({ method: 'PATCH', url: `/api/review-topics/${topic.json().id}`, headers, payload: { status: 'INVALID' } })).statusCode).toBe(400);
    await app.close();
  });
});
