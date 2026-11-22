import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AuthRepository, ReplyRepository, ThreadsRepository, hashPassword } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { buildApp } from './app.js';
import { adminLogin } from './testing.js';

let pool: pg.Pool;
let auth: AuthRepository;
let replies: ReplyRepository;
let threads: ThreadsRepository;
let cookie: string;
let csrf: string;

function makeApp() {
  return buildApp({
    repo: { create: vi.fn(async () => undefined), get: vi.fn(async () => null), list: vi.fn(async () => []) },
    queue: { send: vi.fn(async () => 'job-1') },
    auth, replies, threads
  });
}

beforeAll(async () => {
  pool = await resetTestDatabase();
  auth = new AuthRepository(pool);
  replies = new ReplyRepository(pool);
  threads = new ThreadsRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await auth.ensureAdmin('admin', await hashPassword('password-lokal-yang-kuat'));
  const session = await adminLogin(makeApp());
  cookie = session.cookie;
  csrf = session.csrf;
});

describe('API balasan Threads Fase 4B (PostgreSQL)', () => {
  it('semua rute balasan menolak akses tanpa sesi', async () => {
    const app = makeApp();
    for (const [method, url] of [['GET', '/api/threads/replies/settings'], ['GET', '/api/threads/replies'], ['POST', '/api/threads/replies']] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('settings bawaan: live balasan MATI', async () => {
    const response = await makeApp().inject({ method: 'GET', url: '/api/threads/replies/settings', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().livePosting).toBe(false);
  });

  it('POST balasan: live mati → 200 + REQUIRES_LIVE saat diproses, anti-duplikat 409', async () => {
    const app = makeApp();
    const headers = { cookie, 'x-csrf-token': csrf };
    const first = await app.inject({ method: 'POST', url: '/api/threads/replies', headers, payload: { replyToId: 'post-1', text: 'Halo' } });
    expect(first.statusCode).toBe(200);
    expect(first.json().liveEnabled).toBe(false);
    const second = await app.inject({ method: 'POST', url: '/api/threads/replies', headers, payload: { replyToId: 'post-1', text: 'Halo' } });
    expect(second.statusCode).toBe(409);
  });

  it('validasi: teks >500 byte ditolak', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'POST', url: '/api/threads/replies', headers: { cookie, 'x-csrf-token': csrf }, payload: { replyToId: 'p', text: '😀'.repeat(200) } });
    expect(response.statusCode).toBe(400);
  });

  it('PATCH settings mengubah live & pause', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'PATCH', url: '/api/threads/replies/settings', headers: { cookie, 'x-csrf-token': csrf }, payload: { livePosting: true, paused: true, dailyLimit: 7 } });
    expect(response.statusCode).toBe(200);
    expect(response.json().dailyLimit).toBe(7);
    expect(response.json().paused).toBe(true);
  });

  it('GET daftar & detail balasan', async () => {
    const app = makeApp();
    const created = await app.inject({ method: 'POST', url: '/api/threads/replies', headers: { cookie, 'x-csrf-token': csrf }, payload: { replyToId: 'p1', text: 'A' } });
    const id = created.json().reply.id;
    expect((await app.inject({ method: 'GET', url: '/api/threads/replies', headers: { cookie } })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/api/threads/replies/${id}`, headers: { cookie } })).statusCode).toBe(200);
  });
});
