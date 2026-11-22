import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_OAUTH_REDIRECT, DEFAULT_SCOPES, buildAuthorizeUrl } from './threads-oauth.js';
import type { PublishQueueRow, ThreadsConnection, ThreadsRepository } from '@threads-id/db';
import { connectionStatusFromEnv, threadsEnv } from '@threads-id/db';

const publishSchema = z.object({
  draftId: z.uuid(),
  queueId: z.uuid().optional()
});
const liveSchema = z.object({ livePosting: z.boolean() });
const resolveSchema = z.object({ resolution: z.enum(['PUBLISHED', 'FAILED']), mediaId: z.string().optional() });

export function registerThreadsRoutes(app: FastifyInstance, threads: ThreadsRepository): void {
  // Status koneksi tidak pernah membocorkan token/secret: hanya boolean presence + status.
  app.get('/api/threads/connection', async () => {
    const stored = await threads.getConnection();
    const env = threadsEnv();
    const configured = connectionStatusFromEnv();
    const connection: ThreadsConnection = stored ?? {
      appId: env.appId ?? null,
      appSecretPresent: Boolean(env.appSecret),
      userId: env.userId ?? null,
      accessTokenPresent: Boolean(env.accessToken),
      tokenExpiresAt: null,
      scopes: env.scopes.join(','),
      status: configured,
      livePosting: env.livePosting,
      note: null
    };
    return {
      appId: connection.appId,
      appSecretPresent: connection.appSecretPresent,
      userId: connection.userId,
      accessTokenPresent: connection.accessTokenPresent,
      tokenExpiresAt: connection.tokenExpiresAt,
      scopes: connection.scopes,
      status: connection.status,
      livePosting: connection.livePosting,
      note: connection.note
    };
  });

  /** URL authorize untuk dipakai operator di browser (rahasia app tidak pernah dikirim ke klien). */
  app.get('/api/threads/oauth-url', async (request, reply) => {
    const env = threadsEnv();
    if (!env.appId) return reply.code(400).send({ error: 'THREADS_APP_ID belum diisi di server.' });
    const redirectUri = (request.query as { redirectUri?: string }).redirectUri ?? DEFAULT_OAUTH_REDIRECT;
    const state = randomBytes(24).toString('hex');
    return {
      url: buildAuthorizeUrl({ appId: env.appId, redirectUri, state, scopes: DEFAULT_SCOPES }),
      state,
      redirectUri
    };
  });

  /** Halaman web menampilkan URL ini; token yang dikembalikan hanya presence + expiry. */
  app.post('/api/threads/oauth-callback', async (request, reply) => {
    const parsed = z.object({ code: z.string().min(1), redirectUri: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Code OAuth wajib diisi.' });
    const env = threadsEnv();
    if (!env.appId || !env.appSecret) return reply.code(400).send({ error: 'THREADS_APP_ID/THREADS_APP_SECRET belum diisi di server.' });
    const redirectUri = parsed.data.redirectUri ?? DEFAULT_OAUTH_REDIRECT;
    // Tukar code → token di server; token mentah TIDAK disimpan di DB (hanya presence + expiry).
    let token: { accessToken: string; expiresIn: number | null; userId: string };
    try {
      token = await exchangeOAuthCode({ code: parsed.data.code, appId: env.appId, appSecret: env.appSecret, redirectUri });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal menukar code OAuth';
      return reply.code(502).send({ error: message });
    }
    const expiresAt = new Date(Date.now() + (token.expiresIn ? token.expiresIn * 1000 : 60 * 24 * 3600_000));
    const connection = await threads.upsertConnection({
      appId: env.appId,
      appSecretPresent: true,
      userId: token.userId,
      accessTokenPresent: true,
      tokenExpiresAt: expiresAt.toISOString(),
      scopes: env.scopes.join(','),
      status: env.livePosting ? 'CONNECTED' : 'DISCONNECTED',
      livePosting: env.livePosting,
      note: 'Token long-lived aktif. Nilai token hanya dibaca worker dari environment server (THREADS_ACCESS_TOKEN); dashboard tidak pernah menampilkan token.'
    });
    return {
      ok: true,
      userId: connection.userId,
      scopes: connection.scopes,
      tokenExpiresAt: connection.tokenExpiresAt,
      livePosting: connection.livePosting,
      note: connection.note
    };
  });

  /** Endpoint callback publik untuk redirect Meta (tanpa sesi admin; code sekali pakai). */
  app.get('/api/threads/oauth-callback', async (request, reply) => {
    const query = request.query as { code?: string; error?: string; error_reason?: string; error_description?: string };
    if (!query.code) {
      const detail = query.error_description ?? query.error_reason ?? query.error ?? 'Code tidak ada';
      return reply.code(400).type('text/html; charset=utf-8').send(
        `<html lang="id"><body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1>OAuth Threads gagal</h1><p>${String(detail).replace(/[<>&]/g, '')}</p>
<p>Consent belum selesai. Buka dashboard → <b>Publikasi</b> → <b>Buka halaman OAuth Meta</b>, lalu klik <b>Authorize</b>.</p>
<p><a href="http://127.0.0.1:8080/">Kembali ke dashboard</a></p></body></html>`
      );
    }
    const env = threadsEnv();
    if (!env.appId || !env.appSecret) return reply.code(400).send({ error: 'THREADS_APP_ID/THREADS_APP_SECRET belum diisi di server.' });
    let token: { accessToken: string; expiresIn: number | null; userId: string };
    try {
      token = await exchangeOAuthCode({ code: query.code, appId: env.appId, appSecret: env.appSecret, redirectUri: DEFAULT_OAUTH_REDIRECT });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : 'Gagal menukar code OAuth' });
    }
    const expiresAt = new Date(Date.now() + (token.expiresIn ? token.expiresIn * 1000 : 60 * 24 * 3600_000));
    const connection = await threads.upsertConnection({
      appId: env.appId, appSecretPresent: true, userId: token.userId, accessTokenPresent: true,
      tokenExpiresAt: expiresAt.toISOString(), scopes: env.scopes.join(','),
      status: env.livePosting ? 'CONNECTED' : 'DISCONNECTED', livePosting: env.livePosting,
      note: 'Token long-lived aktif (lewat redirect Meta).'
    });
    return reply.code(200).send(`<html lang="id"><body style="font-family:system-ui"><h1>Akun terhubung</h1><p>User ID: ${connection.userId}</p><p>Kedaluwarsa: ${connection.tokenExpiresAt ?? 'tidak diketahui'}</p><p>Kembali ke dashboard untuk mengaktifkan live.</p></body></html>`);
  });

  /** Aktifkan/matikan publikasi live. Default tetap mati; mengaktifkan = keputusan operator eksplisit. */
  app.post('/api/threads/live', async (request, reply) => {
    const parsed = liveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Payload harus { livePosting: boolean }' });
    const connection = await threads.setLivePosting(parsed.data.livePosting);
    return connection;
  });

  /** Posting manual dari dashboard: masuk antrean, worker yang memanggil Meta. */
  app.post('/api/threads/publish', async (request, reply) => {
    const parsed = publishSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Draft ID wajib diisi.' });
    const connection = await threads.getConnection();
    const env = threadsEnv();
    const liveEnabled = Boolean(connection?.livePosting ?? env.livePosting);
    const queue = await threads.enqueue({
      id: parsed.data.queueId ?? randomUUID(),
      draftId: parsed.data.draftId,
      trigger: 'MANUAL',
      requestedBy: request.session?.username ?? null,
      liveEnabled
    });
    return reply.code(liveEnabled ? 202 : 200).send({ queue, liveEnabled });
  });

  app.get('/api/threads/publish', async (request, reply) => {
    const parsed = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filter tidak valid.' });
    const status = parsed.data.status as PublishQueueRow['status'] | undefined;
    const rows = await threads.listQueue({ status, limit: parsed.data.limit });
    return rows;
  });

  app.get<{ Params: { id: string } }>('/api/threads/publish/:id', async (request, reply) => {
    const row = await threads.getQueue(request.params.id);
    if (!row) return reply.code(404).send({ error: 'Antrean publish tidak ditemukan.' });
    const attempts = await threads.listAttempts(row.id);
    return { ...row, attempts };
  });

  /** Rekonsiliasi NEEDS_REVIEW oleh operator (bukti dari API Meta). */
  app.post<{ Params: { id: string } }>('/api/threads/publish/:id/resolve', async (request, reply) => {
    const parsed = resolveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Resolusi harus PUBLISHED atau FAILED.' });
    try {
      const row = await threads.resolveNeedsReview(request.params.id, parsed.data.resolution, parsed.data.mediaId);
      if (!row) return reply.code(409).send({ error: 'Hanya antrean NEEDS_REVIEW yang bisa direkonsiliasi.' });
      return row;
    } catch (error) {
      // PUBLISHED wajib media_id ditegakkan trigger DB; jangan anggap sukses.
      const message = error instanceof Error ? error.message : 'Rekonsiliasi gagal';
      return reply.code(400).send({ error: message });
    }
  });
}

/** Tukar code OAuth (pendek) → token long-lived 60 hari. Hanya dipanggil server. */
export async function exchangeOAuthCode(input: { code: string; appId: string; appSecret: string; redirectUri: string }): Promise<{ accessToken: string; expiresIn: number | null; userId: string }> {
  const shortResponse = await fetch('https://graph.threads.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: input.appId, client_secret: input.appSecret, code: input.code,
      grant_type: 'authorization_code', redirect_uri: input.redirectUri
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const shortBody = await shortResponse.json() as { access_token?: string; user_id?: string; error_message?: string; error_type?: string };
  if (!shortResponse.ok || !shortBody.access_token || !shortBody.user_id) {
    throw new OAuthError(shortBody.error_message ?? shortBody.error_type ?? `Meta menolak penukaran code (HTTP ${shortResponse.status}).`);
  }
  const longResponse = await fetch(
    `https://graph.threads.com/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(input.appSecret)}&access_token=${encodeURIComponent(shortBody.access_token)}`,
    { signal: AbortSignal.timeout(30_000) }
  );
  const longBody = await longResponse.json() as { access_token?: string; expires_in?: number; error_message?: string };
  if (!longResponse.ok || !longBody.access_token) {
    throw new OAuthError(longBody.error_message ?? 'Meta menolak long-lived exchange.');
  }
  // Token long-lived dipasang ke env worker lewat file lokal terpisah (tidak ke DB, tidak ke klien).
  await persistWorkerToken(longBody.access_token);
  return { accessToken: longBody.access_token, expiresIn: typeof longBody.expires_in === 'number' ? longBody.expires_in : null, userId: shortBody.user_id };
}

export class OAuthError extends Error {}

/**
 * Token mentah TIDAK masuk DB. Worker membaca dari environment; di Compose lokal token
 * disimpan ke file yang dibaca worker saat start (chmod 600, di luar repo).
 */
async function persistWorkerToken(token: string): Promise<void> {
  const { writeFile, chmod } = await import('node:fs/promises');
  const path = process.env.THREADS_TOKEN_FILE ?? '/tmp/threads-worker-token';
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
