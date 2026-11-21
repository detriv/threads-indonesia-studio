import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import type { AuthLike } from './auth-routes.js';

function fakeAuth(): AuthLike {
  const sessions = new Map<string, { csrfToken: string; expiresAt: Date; username: string }>();
  return {
    verifyCredentials: vi.fn(async (u: string, p: string) => u === 'admin' && p === 'rahasia-unit'),
    createSession: vi.fn(async (h: string, c: string, e: Date, u: string) => { sessions.set(h, { csrfToken: c, expiresAt: e, username: u }); }),
    findSession: vi.fn(async (h: string) => sessions.get(h) ?? null),
    deleteSession: vi.fn(async (h: string) => { sessions.delete(h); })
  };
}

function deps() {
  const actions: Array<Record<string, unknown>> = [];
  return {
    actions,
    auth: fakeAuth(),
    repo: {
      create: vi.fn(async (id: string) => { actions.push({ id, kind: 'SYNTHETIC_AGE_20S', status: 'QUEUED', demo: true }); }),
      get: vi.fn(async (id: string) => actions.find((a) => a.id === id) ?? null),
      list: vi.fn(async () => actions)
    },
    queue: { send: vi.fn(async () => 'job-1') }
  };
}

async function login(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'rahasia-unit' } });
  const cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const csrf = response.cookies.find((c) => c.name === 'csrf')?.value ?? '';
  return { cookie, csrf };
}

describe('demo API (dilindungi admin)', () => {
  it('creates a traceable demo action and enqueues it', async () => {
    const d = deps();
    const app = buildApp(d);
    const { cookie, csrf } = await login(app);
    const response = await app.inject({ method: 'POST', url: '/api/demo/actions', headers: { cookie, 'x-csrf-token': csrf } });
    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ status: 'QUEUED', demo: true });
    expect(body.actionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.repo.create).toHaveBeenCalledWith(body.actionId);
    expect(d.queue.send).toHaveBeenCalledWith(
      'demo.synthetic-age-20s',
      {
        actionId: body.actionId,
        sample: expect.objectContaining({
          pillar: 'KEBIASAAN_DIGITAL',
          format: 'OBSERVASI_PENDEK',
          text: expect.stringContaining('cek jam')
        })
      },
      expect.any(Object)
    );
    await app.close();
  });

  it('exposes health and action history', async () => {
    const d = deps();
    const app = buildApp(d);
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({ ok: true, demo: true });
    const { cookie, csrf } = await login(app);
    await app.inject({ method: 'POST', url: '/api/demo/actions', headers: { cookie, 'x-csrf-token': csrf } });
    const history = await app.inject({ method: 'GET', url: '/api/demo/actions', headers: { cookie } });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toHaveLength(1);
    await app.close();
  });

  it('menolak aksi demo tanpa session admin', async () => {
    const d = deps();
    const app = buildApp(d);
    expect((await app.inject({ method: 'POST', url: '/api/demo/actions' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/demo/actions' })).statusCode).toBe(401);
    await app.close();
  });
});
