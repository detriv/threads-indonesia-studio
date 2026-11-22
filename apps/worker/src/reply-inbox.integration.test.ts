import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { EditorialRepository, ReplyRepository, ThreadsRepository } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { processReplyInbox } from './reply-inbox.js';

let pool: pg.Pool;
let replies: ReplyRepository;
let threads: ThreadsRepository;
let editorial: EditorialRepository;

const posts = { data: [{ id: 'post-1' }, { id: 'post-2' }] };
const repliesByPost: Record<string, unknown[]> = {
  'post-1': [
    { id: 'in-1', text: 'kapan bikin part 2?', username: 'budi', is_reply_owned_by_me: false },
    { id: 'in-2', text: 'aku yang bales duluan ya', username: 'lorem_ipsum7777', is_reply_owned_by_me: true }
  ],
  'post-2': []
};

const transport = (async (url: RequestInfo | URL) => {
  const text = String(url);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (text.includes('/me/threads')) return json(posts);
  const match = text.match(/\/([^/]+)\/replies/);
  if (match?.[1]) return json({ data: repliesByPost[match[1]] ?? [] });
  return json({});
}) as unknown as typeof fetch;

beforeAll(async () => {
  pool = await resetTestDatabase();
  replies = new ReplyRepository(pool);
  threads = new ThreadsRepository(pool);
  editorial = new EditorialRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await editorial.seedDefaults();
  await threads.upsertConnection({
    appId: 'app', appSecretPresent: true, userId: 'user', accessTokenPresent: true,
    status: 'DISCONNECTED', livePosting: false, scopes: 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies'
  });
});

const deps = (extra: { draft?: (input: { username: string | null; text: string }) => Promise<string | null> } = {}) => ({
  replies, threads, editorial, transport, token: () => 'token-fixture', ...extra
});

describe('worker kotak masuk balasan (PostgreSQL, transport dimock)', () => {
  it('menyimpan balasan orang lain, melewati balasan milik sendiri', async () => {
    const result = await processReplyInbox({ runId: '11111111-1111-4111-8111-111111111111' }, deps());
    expect(result.posts).toBe(2);
    expect(result.candidates).toBe(1);
    expect(result.newItems).toBe(1);
    const inbox = await replies.listInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.username).toBe('budi');
    expect(inbox[0]!.replyMediaId).toBe('in-1');
  });

  it('auto-draft diisi bila draft provider tersedia; gagal draft tidak menghalangi', async () => {
    const withDraft = await processReplyInbox({ runId: '22222222-2222-4222-8222-222222222222' }, deps({ draft: async () => 'Sip, segera kami bikin.' }));
    expect(withDraft.drafts).toBe(1);
    expect((await replies.listInbox())[0]!.draftText).toBe('Sip, segera kami bikin.');
  });

  it('penarikan ulang tidak menduplikasi balasan masuk', async () => {
    await processReplyInbox({ runId: '33333333-3333-4333-8333-333333333333' }, deps());
    const second = await processReplyInbox({ runId: '44444444-4444-4444-8444-444444444444' }, deps());
    expect(second.newItems).toBe(0);
    expect(await replies.listInbox()).toHaveLength(1);
  });

  it('kegagalan sebagian post tercatat, post lain tetap diproses', async () => {
    const flaky = (async (url: RequestInfo | URL) => {
      const text = String(url);
      if (text.includes('/me/threads')) return transport(url);
      if (text.includes('post-2')) return new Response('nope', { status: 500 });
      return transport(url);
    }) as unknown as typeof fetch;
    const result = await processReplyInbox({ runId: '55555555-5555-4555-8555-555555555555' }, { replies, threads, editorial, transport: flaky, token: () => 'token-fixture' });
    expect(result.failures.join(' ')).toContain('post-2');
    expect(result.newItems).toBe(1);
  });
});
