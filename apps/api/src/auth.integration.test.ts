import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AuthRepository, hashPassword, hashSessionToken } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { buildApp } from './app.js';

const PASSWORD = 'password-lokal-yang-kuat';
let pool: pg.Pool;
let auth: AuthRepository;

function demoDeps() {
  const actions: Array<Record<string, unknown>> = [];
  return {
    repo: {
      create: vi.fn(async (id: string) => { actions.push({ id, status: 'QUEUED', demo: true }); }),
      get: vi.fn(async (id: string) => actions.find((a) => a.id === id) ?? null),
      list: vi.fn(async () => actions),
      fail: vi.fn(async () => undefined)
    },
    queue: { send: vi.fn(async () => 'job-1') }
  };
}

function makeApp(overrides: Record<string, unknown> = {}) {
  return buildApp({ ...demoDeps(), auth, ...overrides });
}

async function login(app: ReturnType<typeof makeApp>, password = PASSWORD) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password } });
  return response;
}

function cookieHeader(response: Awaited<ReturnType<typeof login>>): string {
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function csrfOf(response: Awaited<ReturnType<typeof login>>): string {
  return response.cookies.find((c) => c.name === 'csrf')?.value ?? '';
}

beforeAll(async () => {
  pool = await resetTestDatabase();
  auth = new AuthRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await auth.ensureAdmin('admin', await hashPassword(PASSWORD));
});

describe('auth API (PostgreSQL)', () => {
  it('login sukses menetapkan cookie HttpOnly SameSite dan menyimpan hash token, bukan token mentah', async () => {
    const app = makeApp();
    const response = await login(app);
    expect(response.statusCode).toBe(200);
    const sid = response.cookies.find((c) => c.name === 'sid');
    expect(sid?.httpOnly).toBe(true);
    expect(sid?.sameSite).toBe('Lax');
    expect(csrfOf(response)).toBeTruthy();
    const body = response.json();
    expect(body).toMatchObject({ ok: true, username: 'admin' });
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
    expect(JSON.stringify(body)).not.toContain(sid?.value ?? '');
    // Token mentah tidak boleh ada di database; hanya hash sha256.
    const rows = await pool.query('SELECT token_hash FROM admin_sessions');
    expect(rows.rows[0]?.token_hash).toBe(hashSessionToken(sid?.value ?? ''));
    expect(rows.rows[0]?.token_hash).not.toBe(sid?.value);
    await app.close();
  });

  it('login gagal untuk password salah dan username tidak dikenal', async () => {
    const app = makeApp();
    expect((await login(app, 'salah')).statusCode).toBe(401);
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'orang-lain', password: PASSWORD } });
    expect(unknown.statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin' } })).statusCode).toBe(400);
    await app.close();
  });

  it('semua rute demo dilindungi: 401 tanpa session, berhasil dengan session', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/demo/actions' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/demo/actions' })).statusCode).toBe(401);
    const session = await login(app);
    const cookies = cookieHeader(session);
    expect((await app.inject({ method: 'GET', url: '/api/demo/actions', headers: { cookie: cookies } })).statusCode).toBe(200);
    const created = await app.inject({ method: 'POST', url: '/api/demo/actions', headers: { cookie: cookies, 'x-csrf-token': csrfOf(session) } });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({ demo: true, status: 'QUEUED' });
    await app.close();
  });

  it('mutasi wajib CSRF: tanpa header 403, header salah 403, header benar lolos', async () => {
    const app = makeApp();
    const session = await login(app);
    const cookies = cookieHeader(session);
    expect((await app.inject({ method: 'POST', url: '/api/demo/actions', headers: { cookie: cookies } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/demo/actions', headers: { cookie: cookies, 'x-csrf-token': 'salah' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/demo/actions', headers: { cookie: cookies, 'x-csrf-token': csrfOf(session) } })).statusCode).toBe(202);
    // GET tidak butuh CSRF.
    expect((await app.inject({ method: 'GET', url: '/api/demo/actions', headers: { cookie: cookies } })).statusCode).toBe(200);
    await app.close();
  });

  it('logout menghapus session dan request berikutnya 401', async () => {
    const app = makeApp();
    const session = await login(app);
    const cookies = cookieHeader(session);
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookies, 'x-csrf-token': csrfOf(session) } });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/demo/actions', headers: { cookie: cookies } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: cookies } })).json()).toMatchObject({ authenticated: false });
    await app.close();
  });

  it('session kedaluwarsa ditolak', async () => {
    const app = makeApp({ sessionTtlMs: 40 });
    const session = await login(app);
    const cookies = cookieHeader(session);
    expect((await app.inject({ method: 'GET', url: '/api/demo/actions', headers: { cookie: cookies } })).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await app.inject({ method: 'GET', url: '/api/demo/actions', headers: { cookie: cookies } })).statusCode).toBe(401);
    await app.close();
  });

  it('rate limit login: 5 gagal lalu 429, dan sukses mereset hitungan', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i += 1) expect((await login(app, 'salah')).statusCode).toBe(401);
    const blocked = await login(app, PASSWORD); // benar pun tetap diblokir
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeTruthy();
    await app.close();
    const app2 = makeApp();
    for (let i = 0; i < 4; i += 1) expect((await login(app2, 'salah')).statusCode).toBe(401);
    expect((await login(app2, PASSWORD)).statusCode).toBe(200);
    expect((await login(app2, 'salah')).statusCode).toBe(401); // hitungan reset setelah sukses
    await app2.close();
  });

  it('GET /api/auth/session publik dan tidak membocorkan rahasia', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/auth/session' })).json()).toEqual({ authenticated: false });
    const session = await login(app);
    const body = (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: cookieHeader(session) } })).json();
    expect(body).toMatchObject({ authenticated: true, username: 'admin' });
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
    await app.close();
  });

  it('log tidak memuat password, token mentah, atau hash password', async () => {
    const chunks: string[] = [];
    const stream = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); } });
    const app = makeApp({ logger: { level: 'info', stream } });
    const session = await login(app);
    await app.inject({ method: 'POST', url: '/api/demo/actions', headers: { cookie: cookieHeader(session), 'x-csrf-token': csrfOf(session) } });
    await login(app, 'salah');
    await app.close();
    const logs = chunks.join('');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain('salah');
    const sid = session.cookies.find((c) => c.name === 'sid')?.value ?? '';
    expect(logs).not.toContain(sid);
    const admin = await auth.findAdmin('admin');
    expect(logs).not.toContain(admin?.passwordHash ?? '');
  });
});
