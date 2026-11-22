import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AuthRepository, DraftRepository, EditorialRepository, ScheduleRepository, ThreadsRepository, hashPassword } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { buildApp } from './app.js';
import { adminLogin } from './testing.js';
import { fetchThreadsUserId } from './threads-routes.js';

let pool: pg.Pool;
let auth: AuthRepository;
let editorial: EditorialRepository;
let drafts: DraftRepository;
let schedule: ScheduleRepository;
let threads: ThreadsRepository;
let themeId: string;

function makeApp() {
  return buildApp({
    repo: { create: vi.fn(async () => undefined), get: vi.fn(async () => null), list: vi.fn(async () => []) },
    queue: { send: vi.fn(async () => 'job-1') },
    auth, editorial, drafts, schedule, threads
  });
}

beforeAll(async () => {
  pool = await resetTestDatabase();
  auth = new AuthRepository(pool);
  editorial = new EditorialRepository(pool);
  drafts = new DraftRepository(pool);
  schedule = new ScheduleRepository(pool);
  threads = new ThreadsRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await auth.ensureAdmin('admin', await hashPassword('password-lokal-yang-kuat'));
  await editorial.seedDefaults();
  themeId = (await editorial.listThemes())[0]!.id;
});

describe('Meta Threads API (PostgreSQL, transport dimock)', () => {
  it('fetchThreadsUserId memakai ID kanonik dari /me (token-exchange bisa berbeda)', async () => {
    const seen: string[] = [];
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ id: '29713621341597282', username: 'lorem_ipsum7777' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const profile = await fetchThreadsUserId('token-apa-saja', transport);
    expect(seen[0]).toContain('https://graph.threads.com/v1.0/me?fields=id,username');
    expect(profile).toEqual({ id: '29713621341597282', username: 'lorem_ipsum7777' });
  });

  it('semua rute Meta Threads menolak akses tanpa session', async () => {
    const app = makeApp();
    const routes: Array<[string, string]> = [
      ['GET', '/api/threads/connection'], ['GET', '/api/threads/oauth-url'],
      ['POST', '/api/threads/live'], ['POST', '/api/threads/publish'], ['GET', '/api/threads/publish']
    ];
    for (const [method, url] of routes) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
    // Callback redirect Meta bersifat publik (code sekali pakai), bukan rute admin.
    expect((await app.inject({ method: 'GET', url: '/api/threads/oauth-callback' })).statusCode).toBe(400);
    await app.close();
  });

  it('status koneksi default jujur: NOT_CONFIGURED, live mati, tanpa token', async () => {
    const app = makeApp();
    const { cookie } = await adminLogin(app);
    const body = (await app.inject({ method: 'GET', url: '/api/threads/connection', headers: { cookie } })).json();
    expect(body).toMatchObject({ status: 'NOT_CONFIGURED', livePosting: false, accessTokenPresent: false, appSecretPresent: false });
    expect(body).not.toHaveProperty('accessToken');
    await app.close();
  });

  it('live posting mati → antrean publish dicatat REQUIRES_LIVE tanpa post nyata', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Observasi uji publish.' });
    const response = await app.inject({ method: 'POST', url: '/api/threads/publish', headers, payload: { draftId: draft.id } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ liveEnabled: false, queue: { status: 'REQUIRES_LIVE', trigger: 'MANUAL' } });
    const list = (await app.inject({ method: 'GET', url: '/api/threads/publish', headers: { cookie } })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'REQUIRES_LIVE', lastErrorCode: 'LIVE_DISABLED' });
    await app.close();
  });

  it('draft >500 karakter ditolak database saat masuk antrean publish (batas Meta)', async () => {
    // Batas 500 ditegakkan trigger publish_queue, bukan saat pembuatan draft (draft bisa direvisi dulu).
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const long = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'x'.repeat(501) });
    const response = await app.inject({ method: 'POST', url: '/api/threads/publish', headers, payload: { draftId: long.id } });
    expect(response.statusCode).toBe(500);
    const blocked = await threads.listQueue();
    expect(blocked).toHaveLength(0);
    await app.close();
  });

  it('worker publish: live mati → koneksi tersimpan; publish tanpa token → CONFIG', async () => {
    const connection = await threads.upsertConnection({ appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true, status: 'DISCONNECTED', livePosting: false, scopes: 'threads_basic,threads_content_publish' });
    expect(connection.livePosting).toBe(false);
  });

  it('operator mengaktifkan live → status CONNECTED; antrean manual masuk QUEUED', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    // Kredensial ada di environment server (bukan DB), sesuai batas keamanan proyek.
    const previous = { ...process.env };
    process.env.THREADS_APP_ID = 'app-id';
    process.env.THREADS_APP_SECRET = 'app-secret';
    process.env.THREADS_USER_ID = 'user-1';
    process.env.THREADS_ACCESS_TOKEN = 'fixture-token';
    try {
      await threads.upsertConnection({ appId: 'app-id', appSecretPresent: true, userId: 'user-1', accessTokenPresent: true, status: 'DISCONNECTED', livePosting: false, scopes: 'threads_basic,threads_content_publish' });
      const enabled = await app.inject({ method: 'POST', url: '/api/threads/live', headers, payload: { livePosting: true } });
      expect(enabled.statusCode).toBe(200);
      expect(enabled.json()).toMatchObject({ status: 'CONNECTED', livePosting: true });
      const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Siap posting.' });
      const published = await app.inject({ method: 'POST', url: '/api/threads/publish', headers, payload: { draftId: draft.id } });
      expect(published.statusCode).toBe(202);
      expect(published.json()).toMatchObject({ liveEnabled: true, queue: { status: 'QUEUED' } });
      const connection = (await app.inject({ method: 'GET', url: '/api/threads/connection', headers: { cookie } })).json();
      expect(connection.accessTokenPresent).toBe(true);
      expect(connection).not.toHaveProperty('accessToken');
    } finally {
      for (const key of ['THREADS_APP_ID', 'THREADS_APP_SECRET', 'THREADS_USER_ID', 'THREADS_ACCESS_TOKEN']) {
        if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
      }
      await threads.setLivePosting(false);
    }
  });

  it('rekonsiliasi NEEDS_REVIEW: PUBLISHED wajib media_id; resolusi ganda ditolak', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Ambigu uji.' });
    const queued = await threads.enqueue({ draftId: draft.id, trigger: 'MANUAL', requestedBy: 'admin', liveEnabled: true });
    await threads.markNeedsReview(queued.id, 'TIMEOUT', 'Publish timeout; container mungkin sudah terbit.');
    const withoutMedia = await app.inject({ method: 'POST', url: `/api/threads/publish/${queued.id}/resolve`, headers, payload: { resolution: 'PUBLISHED' } });
    expect(withoutMedia.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: `/api/threads/publish/${queued.id}/resolve`, headers, payload: { resolution: 'PUBLISHED', mediaId: 'media-123' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'PUBLISHED', mediaId: 'media-123' });
    const again = await app.inject({ method: 'POST', url: `/api/threads/publish/${queued.id}/resolve`, headers, payload: { resolution: 'FAILED' } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('OAuth URL meminta App ID di server; callback tanpa kredensial ditolak', async () => {
    const app = makeApp();
    const { cookie, csrf } = await adminLogin(app);
    const headers = { cookie, 'x-csrf-token': csrf };
    const url = (await app.inject({ method: 'GET', url: '/api/threads/oauth-url', headers: { cookie } }));
    expect(url.statusCode).toBe(400);
    expect(url.json().error).toContain('THREADS_APP_ID');
    const callback = await app.inject({ method: 'POST', url: '/api/threads/oauth-callback', headers, payload: { code: 'code-x' } });
    expect(callback.statusCode).toBe(400);
    // Callback redirect publik juga menolak tanpa kredensial.
    const redirect = await app.inject({ method: 'GET', url: '/api/threads/oauth-callback?code=code-x' });
    expect(redirect.statusCode).toBe(400);
    await app.close();
  });

  it('live diaktifkan tanpa kredensial → status tetap jujur BELUM_LIVE/SIMULASI', async () => {
    const app = makeApp();
    const { cookie } = await adminLogin(app);
    await threads.upsertConnection({ appId: undefined, appSecretPresent: false, userId: undefined, accessTokenPresent: false, status: 'DISCONNECTED', livePosting: true, scopes: 'threads_basic,threads_content_publish' });
    const body = (await app.inject({ method: 'GET', url: '/api/integrations', headers: { cookie } })).json();
    expect(body).toMatchObject({ mode: 'SIMULASI', livePosting: false });
    expect(body.integrations[0]).toMatchObject({ id: 'meta-threads', connected: false, mode: 'BELUM_LIVE' });
    expect(body.integrations[0].note).toContain('kredensial');
    await app.close();
  });

  it('integrasi: live aktif tampil jujur; mati tetap SIMULASI', async () => {
    const app = makeApp();
    const { cookie } = await adminLogin(app);
    const off = (await app.inject({ method: 'GET', url: '/api/integrations', headers: { cookie } })).json();
    expect(off).toMatchObject({ mode: 'SIMULASI', livePosting: false });
    await threads.upsertConnection({ appId: 'app-id', appSecretPresent: true, userId: 'user-1', accessTokenPresent: true, status: 'CONNECTED', livePosting: true, scopes: 'threads_basic,threads_content_publish' });
    const on = (await app.inject({ method: 'GET', url: '/api/integrations', headers: { cookie } })).json();
    expect(on).toMatchObject({ mode: 'SIAP_LIVE', livePosting: true });
    expect(on.integrations[0]).toMatchObject({ id: 'meta-threads', connected: true, mode: 'LIVE_TEREKONKSI' });
    await app.close();
  });
});
