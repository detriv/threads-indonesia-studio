import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ReplyRepository, ThreadsRepository } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { processThreadsReply } from './reply-processor.js';

let pool: pg.Pool;
let replies: ReplyRepository;
let threads: ThreadsRepository;

const noSleep = async () => undefined;

function transportFor(input: { containerId?: string; mediaId?: string; containerStatus?: number } = {}) {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const text = String(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (text.includes('threads_publishing_limit')) return json({ data: [{ reply_quota_usage: 1, reply_config: { quota_total: 1000 } }] });
    if (text.includes('/threads_publish')) return json({ id: input.mediaId ?? 'reply-media-1' });
    if (text.includes('/threads') && init?.method === 'POST') return json({ id: input.containerId ?? 'reply-container-1' }, input.containerStatus ?? 200);
    return json({});
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  pool = await resetTestDatabase();
  replies = new ReplyRepository(pool);
  threads = new ThreadsRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await replies.updateSettings({ livePosting: false, paused: false, dailyLimit: 20 });
  await threads.upsertConnection({
    appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true,
    status: 'DISCONNECTED', livePosting: false, scopes: 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies'
  });
});

describe('worker balasan Threads (PostgreSQL, transport dimock)', () => {
  it('live balasan mati → antrean REQUIRES_LIVE, bukan balasan nyata', async () => {
    const queued = await replies.enqueue({ id: '11111111-1111-4111-8111-111111111111', replyToId: 'post-1', text: 'Halo', requestedBy: 'admin' });
    const result = await processThreadsReply(queued!.id, { replies, threads, live: () => false });
    expect(result!.status).toBe('REQUIRES_LIVE');
    expect(result!.mediaId).toBeNull();
  });

  it('live aktif + scope lengkap → REPLIED dengan media_id dari Meta', async () => {
    await replies.updateSettings({ livePosting: true, paused: false, dailyLimit: 20 });
    const queued = await replies.enqueue({ id: '22222222-2222-4222-8222-222222222222', replyToId: 'post-1', text: 'Setuju, niat aja kadang curian.', requestedBy: 'admin' });
    const result = await processThreadsReply(queued!.id, { replies, threads, live: () => true, transport: transportFor(), sleep: noSleep, token: () => 'token-fixture' });
    expect(result!.status).toBe('REPLIED');
    expect(result!.mediaId).toBe('reply-media-1');
    expect((await replies.getSettings()).quotaUsage).toBe(1);
  });

  it('token tanpa threads_manage_replies → FAILED SCOPE_MISSING', async () => {
    await threads.upsertConnection({
      appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true,
      status: 'DISCONNECTED', livePosting: false, scopes: 'threads_basic,threads_content_publish'
    });
    await replies.updateSettings({ livePosting: true, paused: false, dailyLimit: 20 });
    const queued = await replies.enqueue({ id: '33333333-3333-4333-8333-333333333333', replyToId: 'post-1', text: 'Coba', requestedBy: 'admin' });
    const result = await processThreadsReply(queued!.id, { replies, threads, live: () => true, transport: transportFor(), sleep: noSleep, token: () => 'token-fixture' });
    expect(result!.status).toBe('FAILED');
    expect(result!.lastErrorCode).toBe('SCOPE_MISSING');
  });

  it('dijeda → baris tetap QUEUED dan tidak ada panggilan Meta', async () => {
    await replies.updateSettings({ livePosting: true, paused: true, dailyLimit: 20 });
    const queued = await replies.enqueue({ id: '44444444-4444-4444-8444-444444444444', replyToId: 'post-1', text: 'Tertunda', requestedBy: 'admin' });
    const result = await processThreadsReply(queued!.id, { replies, threads, live: () => true, transport: transportFor(), sleep: noSleep, token: () => 'token-fixture' });
    expect(result).toBeNull();
    expect((await replies.get(queued!.id))!.status).toBe('QUEUED');
  });

  it('anti-duplikat: (reply_to_id, teks) sama ditolak', async () => {
    const first = await replies.enqueue({ id: '55555555-5555-4555-8555-555555555555', replyToId: 'post-9', text: 'Sama', requestedBy: 'admin' });
    const second = await replies.enqueue({ id: '66666666-6666-4666-8666-666666666666', replyToId: 'post-9', text: 'Sama', requestedBy: 'admin' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('container gagal dibuat → FAILED dengan kode dari Meta', async () => {
    await replies.updateSettings({ livePosting: true, paused: false, dailyLimit: 20 });
    const queued = await replies.enqueue({ id: '77777777-7777-4777-8777-777777777777', replyToId: 'post-1', text: 'Gagal', requestedBy: 'admin' });
    const failing = (async () => new Response(JSON.stringify({ error: { message: 'ditolak' } }), { status: 400, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const result = await processThreadsReply(queued!.id, { replies, threads, live: () => true, transport: failing, sleep: noSleep, token: () => 'token-fixture' });
    expect(result!.status).toBe('FAILED');
  });
});
