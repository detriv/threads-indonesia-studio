import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { AuthRepository, DraftRepository, EditorialRepository, ScheduleRepository, ThreadsRepository, TrendRepository, hashPassword } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { buildApp } from './app.js';
import { adminLogin } from './testing.js';

let pool: pg.Pool;
let auth: AuthRepository;
let editorial: EditorialRepository;
let drafts: DraftRepository;
let schedule: ScheduleRepository;
let threads: ThreadsRepository;
let trends: TrendRepository;
let cookie: string;
let csrf: string;

function makeApp() {
  return buildApp({
    repo: { create: vi.fn(async () => undefined), get: vi.fn(async () => null), list: vi.fn(async () => []) },
    queue: { send: vi.fn(async () => 'job-1') },
    auth, editorial, drafts, schedule, threads, trends
  });
}

beforeAll(async () => {
  pool = await resetTestDatabase();
  auth = new AuthRepository(pool);
  editorial = new EditorialRepository(pool);
  drafts = new DraftRepository(pool);
  schedule = new ScheduleRepository(pool);
  threads = new ThreadsRepository(pool);
  trends = new TrendRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await auth.ensureAdmin('admin', await hashPassword('password-lokal-yang-kuat'));
  await editorial.seedDefaults();
  const session = await adminLogin(makeApp());
  cookie = session.cookie;
  csrf = session.csrf;
});

describe('API tren Fase 4A (PostgreSQL)', () => {
  it('semua rute tren menolak akses tanpa sesi', async () => {
    const app = makeApp();
    for (const [method, url] of [['GET', '/api/trends/settings'], ['GET', '/api/trends/items'], ['GET', '/api/trends/candidates'], ['POST', '/api/trends/refresh']] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
    }
  });

  it('GET settings mengembalikan bawaan yang jujur', async () => {
    const response = await makeApp().inject({ method: 'GET', url: '/api/trends/settings', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.enabled).toBe(true);
    expect(body.paused).toBe(false);
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it('PATCH settings menolak ambang di luar 0–100', async () => {
    const app = makeApp();
    const bad = await app.inject({ method: 'PATCH', url: '/api/trends/settings', headers: { cookie, 'x-csrf-token': csrf }, payload: { enabled: true, paused: false, threshold: 101, dailyLimit: 20, sources: [] } });
    expect(bad.statusCode).toBe(400);
    const good = await app.inject({ method: 'PATCH', url: '/api/trends/settings', headers: { cookie, 'x-csrf-token': csrf }, payload: { enabled: true, paused: false, threshold: 65, dailyLimit: 7, sources: [{ id: 'x', name: 'X', url: 'https://x.test/rss' }] } });
    expect(good.statusCode).toBe(200);
    expect(good.json().threshold).toBe(65);
  });

  it('POST refresh mencatat run QUEUED dan bisa dibaca balik', async () => {
    const app = makeApp();
    const created = await app.inject({ method: 'POST', url: '/api/trends/refresh', headers: { cookie, 'x-csrf-token': csrf }, payload: {} });
    expect(created.statusCode).toBe(202);
    const { runId } = created.json();
    const run = await app.inject({ method: 'GET', url: `/api/trends/runs/${runId}`, headers: { cookie } });
    expect(run.statusCode).toBe(200);
    expect(run.json().status).toBe('QUEUED');
  });

  it('POST dismiss menandai kandidat DISMISSED', async () => {
    const itemId = randomUUID();
    await trends.insertItem({ id: itemId, source: 'x', sourceName: 'X', title: 'T', url: 'https://x.test/a', summary: null, publishedAt: null, categories: [], raw: null });
    const candidateId = randomUUID();
    await trends.createCandidate({ id: candidateId, itemId, score: 80, threshold: 60, reasons: [] });
    const app = makeApp();
    const response = await app.inject({ method: 'POST', url: `/api/trends/candidates/${candidateId}/dismiss`, headers: { cookie, 'x-csrf-token': csrf }, payload: {} });
    expect(response.statusCode).toBe(200);
    expect((await trends.listCandidates())[0]!.status).toBe('DISMISSED');
  });

  it('GET items/candidates kosong tanpa error', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/trends/items', headers: { cookie } })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/trends/candidates', headers: { cookie } })).json()).toEqual([]);
  });
});
