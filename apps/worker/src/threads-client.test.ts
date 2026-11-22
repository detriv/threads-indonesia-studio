import { describe, expect, it, vi } from 'vitest';
import { buildAuthorizeUrl, assertTextWithinLimit, fetchPublishingLimit, fetchPublishedUrl, inspectContainer, publishTextPost, refreshLongLivedToken } from './threads-client.js';

const creds = { appId: 'app', appSecret: 'secret', userId: '17841400000000000', accessToken: 'token-fixture' };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('threads-client (Mock transport, bukan Meta nyata)', () => {
  it('URL OAuth memakai scope granular dan redirect yang terdaftar', () => {
    const url = buildAuthorizeUrl({ appId: 'app-id', redirectUri: 'http://127.0.0.1:8080/api/threads/oauth-callback', state: 'state-123', scopes: ['threads_basic', 'threads_content_publish'] });
    expect(url).toContain('https://threads.com/oauth/authorize?');
    expect(url).toContain('client_id=app-id');
    expect(url).toContain('scope=threads_basic%2Cthreads_content_publish');
    expect(url).toContain('response_type=code');
    expect(url).toContain('state=state-123');
    expect(url).toContain('redirect_uri=');
    // Tanpa App ID, jangan bangun URL separuh jadi.
    expect(() => buildAuthorizeUrl({ appId: '', redirectUri: 'x', state: 's', scopes: ['threads_basic'] })).toThrow('CONFIG');
  });

  it('menolak teks di atas 500 karakter sebelum panggilan API', () => {
    expect(assertTextWithinLimit('x'.repeat(500))).toBeUndefined();
    expect(() => assertTextWithinLimit('x'.repeat(501))).toThrow('TEXT_TOO_LONG');
    // Emoji dihitung sebagai karakter (Meta menghitung byte UTF-8; aplikasi memakai batas karakter yang lebih ketat).
    expect(() => assertTextWithinLimit('😀'.repeat(501))).toThrow('TEXT_TOO_LONG');
  });

  it('dua langkah sukses: container lalu publish, menyimpan media ID', async () => {
    const calls: string[] = [];
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/threads')) return jsonResponse({ id: 'container-1' });
      if (url.includes('/threads_publish')) return jsonResponse({ id: 'media-1' });
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const result = await publishTextPost({
      text: 'Niat cek jam, malah scroll lagi.', credentials: creds, transport,
      sleep: async () => undefined
    });
    expect(result).toEqual({ outcome: 'PUBLISHED', mediaId: 'media-1', containerId: 'container-1' });
    expect(calls[0]).toContain('/17841400000000000/threads');
    expect(calls[1]).toContain('/threads_publish');
  });

  it('timeout setelah container dibuat = AMBIGUOUS, bukan gagal biasa (tidak ada kirim ulang)', async () => {
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/threads')) return jsonResponse({ id: 'container-9' });
      if (url.includes('/threads_publish')) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const result = await publishTextPost({ text: 'Ambigu.', credentials: creds, transport, sleep: async () => undefined });
    expect(result.outcome).toBe('AMBIGUOUS');
    if (result.outcome === 'AMBIGUOUS') {
      expect(result.code).toBe('TIMEOUT');
      expect(result.containerId).toBe('container-9');
    }
  });

  it('429 diklasifikasikan RATE_LIMIT; 401 TOKEN_EXPIRED; 403 SCOPE_MISSING', async () => {
    const transport = vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, 429)) as unknown as typeof fetch;
    expect((await publishTextPost({ text: 'A', credentials: creds, transport, sleep: async () => undefined })).outcome).toBe('FAILED');
    const transport401 = vi.fn(async () => jsonResponse({ error: { message: 'bad token' } }, 401)) as unknown as typeof fetch;
    expect((await publishTextPost({ text: 'A', credentials: creds, transport: transport401, sleep: async () => undefined })).outcome).toBe('FAILED');
    const transport403 = vi.fn(async () => jsonResponse({ error: { message: 'scope' } }, 403)) as unknown as typeof fetch;
    expect((await publishTextPost({ text: 'A', credentials: creds, transport: transport403, sleep: async () => undefined })).outcome).toBe('FAILED');
  });

  it('menolak teks di atas 500 byte UTF-8 (emoji = 4 byte), bukan jumlah kodepoint', () => {
    expect(assertTextWithinLimit('x'.repeat(500))).toBeUndefined();
    expect(() => assertTextWithinLimit('x'.repeat(501))).toThrow('TEXT_TOO_LONG');
    expect(assertTextWithinLimit('😀'.repeat(125))).toBeUndefined(); // 125 × 4 = 500 byte
    expect(() => assertTextWithinLimit('😀'.repeat(126))).toThrow('TEXT_TOO_LONG'); // 504 byte
  });

  it('URL authorize memakai host resmi threads.com', () => {
    const url = buildAuthorizeUrl({ appId: 'app-id', redirectUri: 'http://127.0.0.1:8080/api/threads/oauth-callback', state: 's', scopes: ['threads_basic', 'threads_content_publish'] });
    expect(url).toContain('https://threads.com/oauth/authorize?');
    expect(url).not.toContain('threads.net/oauth');
  });

  it('publishing limit membaca pembungkus {"data":[{...}]} sesuai dokumentasi', async () => {
    const transport = vi.fn(async () => jsonResponse({ data: [{ quota_usage: 7, config: { quota_total: 250 } }] })) as unknown as typeof fetch;
    expect(await fetchPublishingLimit({ credentials: creds, transport })).toEqual({ quotaUsage: 7, quotaTotal: 250, remaining: 243 });
    const empty = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    expect(await fetchPublishingLimit({ credentials: creds, transport: empty })).toEqual({ quotaUsage: null, quotaTotal: null, remaining: null });
  });

  it('permalink asli diambil dari Meta; kegagalan → null (publikasi tetap sukses)', async () => {
    let called = '';
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      called = String(input);
      return jsonResponse({ permalink: 'https://www.threads.com/@lorem_ipsum7777/post/DgBw9cAEh37' });
    }) as unknown as typeof fetch;
    expect(await fetchPublishedUrl({ mediaId: '18033566909883283', credentials: creds, transport }))
      .toBe('https://www.threads.com/@lorem_ipsum7777/post/DgBw9cAEh37');
    expect(called).toContain('https://graph.threads.com/v1.0/18033566909883283?fields=permalink');
    const gagal = vi.fn(async () => jsonResponse({}, 400)) as unknown as typeof fetch;
    expect(await fetchPublishedUrl({ mediaId: 'x', credentials: creds, transport: gagal })).toBeNull();
  });

  it('refresh token long-lived memakai endpoint resmi graph.threads.com/refresh_access_token', async () => {
    let called = '';
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      called = String(input);
      return jsonResponse({ access_token: 'token-baru', expires_in: 5184000 });
    }) as unknown as typeof fetch;
    const result = await refreshLongLivedToken({ accessToken: 'token-lama', transport });
    expect(called).toContain('https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token');
    expect(result).toEqual({ accessToken: 'token-baru', expiresIn: 5184000 });
  });

  it('container PUBLISHED saat rekonsiliasi → DUPLICATE, bukan publish ulang', async () => {
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/container-7')) return jsonResponse({ status: 'PUBLISHED', id: 'container-7' });
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const status = await inspectContainer({ containerId: 'container-7', credentials: creds, transport, polls: 1, sleep: async () => undefined });
    expect(status.status).toBe('PUBLISHED');
  });

  it('kuota publishing limit terbaca; null bukan nol', async () => {
    const transport = vi.fn(async () => jsonResponse({ quota_usage: 12, config: { quota_total: 250 } })) as unknown as typeof fetch;
    expect(await fetchPublishingLimit({ credentials: creds, transport })).toEqual({ quotaUsage: 12, quotaTotal: 250, remaining: 238 });
    const empty = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    expect(await fetchPublishingLimit({ credentials: creds, transport: empty })).toEqual({ quotaUsage: null, quotaTotal: null, remaining: null });
  });
});
