import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api.js';
import { jakartaInputValue, jakartaInputToIso, jakartaDayBoundary } from './datetime.js';

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('adds the readable CSRF cookie to authenticated mutations', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal('document', { cookie: 'theme=dark; csrf=csrf-token-value' });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    await apiRequest('/api/themes', { method: 'POST', body: { name: 'Tema baru' } });

    const headers = new Headers(captured?.headers);
    expect(headers.get('x-csrf-token')).toBe('csrf-token-value');
    expect(headers.get('content-type')).toBe('application/json');
    expect(captured?.credentials).toBe('same-origin');
    expect(captured?.body).toBe(JSON.stringify({ name: 'Tema baru' }));
  });

  it('does not require a CSRF cookie for login and surfaces Indonesian API errors', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ error: 'Kredensial tidak valid' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }));

    await expect(apiRequest('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'x' } }))
      .rejects.toThrow('Kredensial tidak valid');
    expect(new Headers(captured?.headers).has('x-csrf-token')).toBe(false);
  });
});

describe('waktu input Asia/Jakarta', () => {
  it('round-trips UTC timestamps through explicit WIB datetime-local values', () => {
    const utc = '2026-11-22T02:15:00.000Z';
    expect(jakartaInputValue(utc)).toBe('2026-11-22T09:15');
    expect(jakartaInputToIso('2026-11-22T09:15')).toBe(utc);
  });

  it('uses the complete Jakarta calendar day for inclusive history filters', () => {
    expect(jakartaDayBoundary('2026-11-22')).toBe('2026-11-21T17:00:00.000Z');
    expect(jakartaDayBoundary('2026-11-22', true)).toBe('2026-11-22T16:59:59.999Z');
  });
});
