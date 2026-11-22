import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { DraftRepository, EditorialRepository, ScheduleRepository, ThreadsRepository } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { createSimulationAdapter, processScheduleJob } from './schedule-processor.js';
import { processThreadsPublish } from './threads-processor.js';

let pool: pg.Pool;
let editorial: EditorialRepository;
let drafts: DraftRepository;
let schedule: ScheduleRepository;
let threads: ThreadsRepository;
let themeId: string;

beforeAll(async () => {
  pool = await resetTestDatabase();
  editorial = new EditorialRepository(pool);
  drafts = new DraftRepository(pool);
  schedule = new ScheduleRepository(pool);
  threads = new ThreadsRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await editorial.seedDefaults();
  themeId = (await editorial.listThemes())[0]!.id;
});

async function makeScheduledDraft(offsetMs = -2000) {
  const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Observasi uji worker: niat nabung malah checkout.' });
  const entry = await schedule.create(draft.id, new Date(Date.now() + offsetMs));
  return { draft, entry };
}

const noSleep = async () => undefined;

describe('worker publish Threads (PostgreSQL, transport dimock)', () => {
  it('live mati: eksekusi jadwal mencatat antrean REQUIRES_LIVE, bukan post nyata', async () => {
    await threads.upsertConnection({ appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true, status: 'DISCONNECTED', livePosting: false, scopes: 'threads_basic,threads_content_publish' });
    const { entry } = await makeScheduledDraft();
    const outcome = await processScheduleJob(
      { scheduleId: entry.id, version: 1 },
      schedule,
      createSimulationAdapter(),
      {
        livePosting: true,
        threads: {
          enqueueFromSchedule: async ({ draftId, scheduleId }) =>
            threads.enqueue({ draftId, scheduleId, trigger: 'SCHEDULED', requestedBy: 'scheduler', liveEnabled: false })
        }
      }
    );
    expect(outcome).toBe('QUEUED');
    const queue = await threads.listQueue({ status: 'REQUIRES_LIVE' });
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ trigger: 'SCHEDULED', lastErrorCode: 'LIVE_DISABLED' });
  });

  it('live aktif: jadwal masuk antrean publish QUEUED; bukan SIMULATED_OK', async () => {
    await threads.upsertConnection({ appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true, status: 'CONNECTED', livePosting: true, scopes: 'threads_basic,threads_content_publish' });
    const { entry } = await makeScheduledDraft();
    const outcome = await processScheduleJob(
      { scheduleId: entry.id, version: 1 },
      schedule,
      createSimulationAdapter(),
      {
        livePosting: true,
        threads: {
          enqueueFromSchedule: async ({ draftId, scheduleId }) =>
            threads.enqueue({ draftId, scheduleId, trigger: 'SCHEDULED', requestedBy: 'scheduler', liveEnabled: true })
        }
      }
    );
    expect(outcome).toBe('QUEUED');
    const executions = await schedule.listExecutions();
    expect(executions.some((row) => row.status === 'SIMULATED_OK')).toBe(false);
    expect(executions.some((row) => row.status === 'DUPLICATE')).toBe(true);
  });

  it('worker publish sukses: PUBLISHED dengan media_id dari Meta (mock transport)', async () => {
    await threads.upsertConnection({ appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true, status: 'CONNECTED', livePosting: true, scopes: 'threads_basic,threads_content_publish' });
    const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Terbit lewat mock.' });
    const queue = await threads.enqueue({ draftId: draft.id, trigger: 'MANUAL', requestedBy: 'admin', liveEnabled: true });
    const result = await processThreadsPublish(queue.id, {
      threads,
      token: () => 'fixture-token',
      draftText: async (id) => ({ id, text: draft.text }),
      sleep: noSleep,
      limit: async () => ({ quotaUsage: 1, quotaTotal: 250, remaining: 249 }),
      transport: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/threads')) return new Response(JSON.stringify({ id: 'container-1' }), { status: 200 });
        if (url.includes('/threads_publish')) return new Response(JSON.stringify({ id: 'media-1' }), { status: 200 });
        return new Response(JSON.stringify({ quota_usage: 1, config: { quota_total: 250 } }), { status: 200 });
      }) as unknown as typeof fetch
    });
    expect(result).toMatchObject({ status: 'PUBLISHED', mediaId: 'media-1' });
    const attempts = await threads.listAttempts(queue.id);
    expect(attempts.some((a) => a.step === 'PUBLISH' && a.outcome === 'OK')).toBe(true);
  });

  it('timeout setelah container = NEEDS_REVIEW + attempt AMBIGUOUS; tidak ada publish ulang', async () => {
    await threads.upsertConnection({ appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true, status: 'CONNECTED', livePosting: true, scopes: 'threads_basic,threads_content_publish' });
    const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Ambigu mock.' });
    const queue = await threads.enqueue({ draftId: draft.id, trigger: 'MANUAL', requestedBy: 'admin', liveEnabled: true });
    let publishCalls = 0;
    const result = await processThreadsPublish(queue.id, {
      threads,
      token: () => 'fixture-token',
      draftText: async (id) => ({ id, text: draft.text }),
      sleep: noSleep,
      limit: async () => ({ quotaUsage: 1, quotaTotal: 250, remaining: 249 }),
      inspect: async () => ({ status: 'IN_PROGRESS', errorMessage: null, mediaId: null }),
      transport: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/threads')) return new Response(JSON.stringify({ id: 'container-1' }), { status: 200 });
        if (url.includes('/threads_publish')) { publishCalls += 1; throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }
        return new Response(JSON.stringify({ status: 'IN_PROGRESS' }), { status: 200 });
      }) as unknown as typeof fetch
    });
    expect(result?.status).toBe('NEEDS_REVIEW');
    expect(publishCalls).toBe(1);
    const attempts = await threads.listAttempts(queue.id);
    expect(attempts.some((a) => a.outcome === 'AMBIGUOUS')).toBe(true);
  });

  it('user_id/app_id dari env dipakai bila DB belum pernah OAuth', async () => {
    const previous = { ...process.env };
    process.env.THREADS_APP_ID = 'env-app';
    process.env.THREADS_USER_ID = 'env-user';
    try {
      await threads.upsertConnection({ appId: undefined, appSecretPresent: true, userId: undefined, accessTokenPresent: false, status: 'CONNECTED', livePosting: true, scopes: 'threads_basic,threads_content_publish' });
      const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Fallback env user id.' });
      const queue = await threads.enqueue({ draftId: draft.id, trigger: 'MANUAL', requestedBy: 'admin', liveEnabled: true });
      const result = await processThreadsPublish(queue.id, {
        threads,
        token: () => 'fixture-token',
        draftText: async (id) => ({ id, text: draft.text }),
        sleep: noSleep,
        limit: async () => ({ quotaUsage: 0, quotaTotal: 250, remaining: 250 }),
        transport: vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith('/threads')) return new Response(JSON.stringify({ id: 'container-env' }), { status: 200 });
          if (url.includes('/threads_publish')) return new Response(JSON.stringify({ id: 'media-env' }), { status: 200 });
          return new Response(JSON.stringify({ quota_usage: 0, config: { quota_total: 250 } }), { status: 200 });
        }) as unknown as typeof fetch
      });
      expect(result).toMatchObject({ status: 'PUBLISHED', mediaId: 'media-env' });
    } finally {
      for (const key of ['THREADS_APP_ID', 'THREADS_USER_ID']) {
        if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
      }
    }
  });

  it('token kedaluwarsa → refresh otomatis lalu publish (mock)', async () => {
    await threads.upsertConnection({ appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true, tokenExpiresAt: new Date(Date.now() - 1000).toISOString(), status: 'TOKEN_EXPIRED', livePosting: true, scopes: 'threads_basic,threads_content_publish' });
    const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Refresh token uji.' });
    const queue = await threads.enqueue({ draftId: draft.id, trigger: 'MANUAL', requestedBy: 'admin', liveEnabled: true });
    const persisted: string[] = [];
    const result = await processThreadsPublish(queue.id, {
      threads,
      token: () => 'token-lama',
      persistToken: async (token) => { persisted.push(token); },
      draftText: async (id) => ({ id, text: draft.text }),
      sleep: noSleep,
      limit: async () => ({ quotaUsage: 0, quotaTotal: 250, remaining: 250 }),
      transport: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/refresh_access_token')) return new Response(JSON.stringify({ access_token: 'token-baru', expires_in: 5184000 }), { status: 200 });
        if (url.endsWith('/threads')) return new Response(JSON.stringify({ id: 'container-refresh' }), { status: 200 });
        if (url.includes('/threads_publish')) return new Response(JSON.stringify({ id: 'media-refresh' }), { status: 200 });
        return new Response(JSON.stringify({ data: [{ quota_usage: 0, config: { quota_total: 250 } }] }), { status: 200 });
      }) as unknown as typeof fetch
    });
    expect(result).toMatchObject({ status: 'PUBLISHED', mediaId: 'media-refresh' });
    expect(persisted).toEqual(['token-baru']);
    const connection = await threads.getConnection();
    expect(connection?.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) > Date.now()).toBe(true);
  });

  it('konkuren/restart: dua proses worker sama antrean hanya satu yang memanggil Meta', async () => {
    await threads.upsertConnection({ appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true, status: 'CONNECTED', livePosting: true, scopes: 'threads_basic,threads_content_publish' });
    const draft = await drafts.create({ themeId, format: 'OBSERVASI_PENDEK', text: 'Konkuren mock.' });
    const queue = await threads.enqueue({ draftId: draft.id, trigger: 'MANUAL', requestedBy: 'admin', liveEnabled: true });
    let containerCalls = 0;
    const deps = {
      threads,
      token: () => 'fixture-token',
      draftText: async (id: string) => ({ id, text: draft.text }),
      sleep: noSleep,
      limit: async () => ({ quotaUsage: 1, quotaTotal: 250, remaining: 249 }),
      transport: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/threads')) { containerCalls += 1; return new Response(JSON.stringify({ id: 'container-1' }), { status: 200 }); }
        if (url.includes('/threads_publish')) return new Response(JSON.stringify({ id: 'media-1' }), { status: 200 });
        return new Response(JSON.stringify({ quota_usage: 1, config: { quota_total: 250 } }), { status: 200 });
      }) as unknown as typeof fetch
    };
    const results = await Promise.all([processThreadsPublish(queue.id, deps), processThreadsPublish(queue.id, deps)]);
    expect(containerCalls).toBe(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.some((r) => r?.status === 'PUBLISHED')).toBe(true);
  });
});
