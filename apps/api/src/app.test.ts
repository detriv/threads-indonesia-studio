import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';

function deps() {
  const actions: Array<Record<string, unknown>> = [];
  return {
    actions,
    repo: {
      create: vi.fn(async (id: string) => { actions.push({ id, kind: 'SYNTHETIC_AGE_20S', status: 'QUEUED', demo: true }); }),
      get: vi.fn(async (id: string) => actions.find((a) => a.id === id) ?? null),
      list: vi.fn(async () => actions)
    },
    queue: { send: vi.fn(async () => 'job-1') }
  };
}

describe('demo API', () => {
  it('creates a traceable demo action and enqueues it', async () => {
    const d = deps();
    const app = buildApp(d);
    const response = await app.inject({ method: 'POST', url: '/api/demo/actions' });
    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ status: 'QUEUED', demo: true });
    expect(body.actionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.repo.create).toHaveBeenCalledWith(body.actionId);
    expect(d.queue.send).toHaveBeenCalledWith('demo.synthetic-age-20s', { actionId: body.actionId }, expect.any(Object));
    await app.close();
  });

  it('exposes health and action history', async () => {
    const d = deps();
    const app = buildApp(d);
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({ ok: true, demo: true });
    await app.inject({ method: 'POST', url: '/api/demo/actions' });
    const history = await app.inject({ method: 'GET', url: '/api/demo/actions' });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toHaveLength(1);
    await app.close();
  });
});
