import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { TrendSource } from '@threads-id/contracts';
import { DraftRepository, EditorialRepository, TrendRepository } from '@threads-id/db';
import { resetTestDatabase, truncateAll } from '@threads-id/db/testing';
import { processTrendDiscovery } from './trend-processor.js';

let pool: pg.Pool;
let editorial: EditorialRepository;
let drafts: DraftRepository;
let trends: TrendRepository;

const sources: TrendSource[] = [{ id: 'contoh', name: 'Contoh', url: 'https://contoh.test/rss' }];

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item><title>Scroll medsos sampai lupa deadline kuliah</title><link>https://contoh.test/kuat</link>
<pubDate>${new Date().toUTCString()}</pubDate><description>Kebiasaan digital anak kos</description><category>teknologi</category></item>
<item><title>Saham naik tipis</title><link>https://contoh.test/lemah</link>
<pubDate>Mon, 01 Jan 2020 00:00:00 GMT</pubDate><description>Pergerakan indeks</description></item>
</channel></rss>`;

const transport = (async () => new Response(feed, { status: 200, headers: { 'content-type': 'application/rss+xml' } })) as typeof fetch;
const failing = (async () => new Response('boom', { status: 500 })) as typeof fetch;

beforeAll(async () => {
  pool = await resetTestDatabase();
  editorial = new EditorialRepository(pool);
  drafts = new DraftRepository(pool);
  trends = new TrendRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  await truncateAll(pool);
  await editorial.seedDefaults();
  await trends.updateSettings({ enabled: true, paused: false, threshold: 60, dailyLimit: 5, sources });
});

describe('worker discovery tren (PostgreSQL, transport dimock)', () => {
  it('item ≥ ambang jadi draft TREN_RELEVAN berstatus IN_REVIEW', async () => {
    const result = await processTrendDiscovery({ runId: '11111111-1111-4111-8111-111111111111' }, { trends, drafts, editorial, transport });
    expect(result.state).toBe('OK');
    expect(result.items).toBe(2);
    expect(result.drafts).toBe(1);
    const draft = (await drafts.list()).find((item) => item.format === 'TREN_RELEVAN');
    expect(draft?.status).toBe('IN_REVIEW');
    expect(draft?.sourceUrl).toBe('https://contoh.test/kuat');
    expect(draft?.relevanceNote).toContain('Skor');
    const candidates = await trends.listCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.draftId).toBe(draft!.id);
  });

  it('item di bawah ambang tetap disimpan tapi tidak jadi draft', async () => {
    const result = await processTrendDiscovery({ runId: '22222222-2222-4222-8222-222222222222' }, { trends, drafts, editorial, transport });
    expect(result.drafts).toBe(1);
    expect(await trends.listRecentItems(10)).toHaveLength(2);
  });

  it('discovery nonaktif/dijeda tidak memproses apa pun', async () => {
    await trends.updateSettings({ enabled: false, paused: false, threshold: 60, dailyLimit: 5, sources });
    const off = await processTrendDiscovery({ runId: '33333333-3333-4333-8333-333333333333' }, { trends, drafts, editorial, transport });
    expect(off.state).toBe('DISABLED');
    await trends.updateSettings({ enabled: true, paused: true, threshold: 60, dailyLimit: 5, sources });
    const paused = await processTrendDiscovery({ runId: '44444444-4444-4444-8444-444444444444' }, { trends, drafts, editorial, transport });
    expect(paused.state).toBe('PAUSED');
    expect(await trends.listRecentItems(10)).toHaveLength(0);
  });

  it('dedupe: discovery berulang tidak membuat draft ganda', async () => {
    const deps = { trends, drafts, editorial, transport };
    await processTrendDiscovery({ runId: '55555555-5555-4555-8555-555555555555' }, deps);
    const second = await processTrendDiscovery({ runId: '66666666-6666-4666-8666-666666666666' }, deps);
    expect(second.newItems).toBe(0);
    expect(second.drafts).toBe(0);
    expect((await drafts.list()).filter((draft) => draft.format === 'TREN_RELEVAN')).toHaveLength(1);
  });

  it('kegagalan satu sumber tercatat, sumber lain tetap diproses', async () => {
    await trends.updateSettings({ enabled: true, paused: false, threshold: 60, dailyLimit: 5, sources: [...sources, { id: 'mati', name: 'Mati', url: 'https://mati.test/rss' }] });
    const result = await processTrendDiscovery({ runId: '77777777-7777-4777-8777-777777777777' }, {
      trends, drafts, editorial,
      transport: (async (input: RequestInfo | URL) => (String(input).includes('mati') ? failing(input) : transport(input))) as typeof fetch
    });
    expect(result.failures.join(' ')).toContain('Mati');
    expect(result.drafts).toBe(1);
  });

  it('daily_limit menahan kandidat berikutnya', async () => {
    await trends.updateSettings({ enabled: true, paused: false, threshold: 0, dailyLimit: 1, sources });
    const result = await processTrendDiscovery({ runId: '88888888-8888-4888-8888-888888888888' }, { trends, drafts, editorial, transport });
    expect(result.drafts).toBe(1);
    expect(result.skippedLimit).toBeGreaterThan(0);
  });
});
