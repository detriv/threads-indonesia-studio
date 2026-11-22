import { randomUUID } from 'node:crypto';
import { THREADS_JOB_NAME } from '@threads-id/contracts';
import { threadsEnv, tokenExpired } from '@threads-id/db';
import type { PublishQueueRow, ThreadsRepository } from '@threads-id/db';
import type { ThreadsCredentials, ThreadsTransport } from './threads-client.js';
import { assertLiveAllowed, fetchPublishingLimit, fetchPublishedUrl, inspectContainer, publishTextPost, refreshLongLivedToken } from './threads-client.js';

export type ThreadsPublishDeps = {
  threads: ThreadsRepository;
  draftText: (draftId: string) => Promise<{ id: string; text: string } | null>;
  transport?: ThreadsTransport | undefined;
  /** Token Meta dari environment server / file yang ditulis API saat OAuth. */
  token?: () => string | undefined;
  /** Simpan token baru setelah refresh (file 0600); tidak pernah ke DB. */
  persistToken?: (token: string) => Promise<void> | undefined;
  /** Tidur ~30 detik sebelum publish (Meta); bisa disuntik di test. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Rekonsiliasi status container saat ambigu; bisa disuntik di test. */
  inspect?: typeof inspectContainer | undefined;
  /** Baca kuota sebelum publish; bisa disuntik di test. */
  limit?: typeof fetchPublishingLimit | undefined;
  /** Ambil permalink asli; bisa disuntik di test. */
  permalink?: (input: { mediaId: string; credentials: ThreadsCredentials }) => Promise<string | null> | undefined;
  /** Dipanggil saat hasil ambigu; worker melempar error agar pg-boss retry dengan backoff. */
  onAmbiguous?: (row: PublishQueueRow, code: string, message: string) => void;
};

const MAX_ATTEMPTS = 3;

/** Permalink asli dari Meta; bila gagal, simpan null (publikasi tetap sukses). */
async function publishedUrlFor(mediaId: string, credentials: ThreadsCredentials, deps: ThreadsPublishDeps): Promise<string | null> {
  if (deps.permalink) return (await deps.permalink({ mediaId, credentials })) ?? null;
  return fetchPublishedUrl({ mediaId, credentials, transport: deps.transport });
}

/**
 * Proses satu baris antrean publish:
 * - klaim atomik (hanya satu worker yang memanggil Meta);
 * - dua langkah container → publish;
 * - ambigu setelah pengiriman → NEEDS_REVIEW + retry terbatas, tidak pernah kirim ulang buta;
 * - sukses → PUBLISHED + media_id dari Meta (wajib).
 */
export async function processThreadsPublish(queueId: string, deps: ThreadsPublishDeps): Promise<PublishQueueRow | null> {
  const claimed = await deps.threads.claimQueue(queueId);
  if (!claimed) return null;
  const draft = await deps.draftText(claimed.draftId);
  if (!draft) {
    await deps.threads.markFailed(queueId, 'DRAFT_MISSING', 'Draft tidak ditemukan; publikasi dibatalkan.');
    return deps.threads.getQueue(queueId);
  }
  const connection = await deps.threads.getConnection();
  if (!connection) {
    await deps.threads.markFailed(queueId, 'CONFIG', 'Koneksi Meta Threads belum diatur.');
    return deps.threads.getQueue(queueId);
  }
  // DB (hasil OAuth) adalah sumber utama; env menjadi fallback bila operator mengisi manual.
  const envFallback = threadsEnv();
  const tokenValue = deps.token?.() ?? envFallback.accessToken;
  const effective = {
    ...connection,
    appId: connection.appId ?? envFallback.appId,
    userId: connection.userId ?? envFallback.userId,
    accessTokenPresent: connection.accessTokenPresent || Boolean(tokenValue)
  };
  // Token long-lived 60 hari: segarkan otomatis bila sudah kedaluwarsa.
  if (tokenExpired(connection.tokenExpiresAt)) {
    try {
      const refreshed = await refreshLongLivedToken({ accessToken: tokenValue, transport: deps.transport });
      await deps.persistToken?.(refreshed.accessToken);
      const expiresAt = new Date(Date.now() + (refreshed.expiresIn ?? 60 * 24 * 3600) * 1000);
      await deps.threads.updateToken(expiresAt.toISOString());
      effective.tokenExpiresAt = expiresAt.toISOString();
      deps.token = () => refreshed.accessToken;
    } catch {
      await deps.threads.markFailed(queueId, 'TOKEN_EXPIRED', 'Token Threads kedaluwarsa dan refresh gagal; hubungkan ulang lewat OAuth.');
      return deps.threads.getQueue(queueId);
    }
  }
  try {
    assertLiveAllowed(effective);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'CONFIG';
    await deps.threads.markFailed(queueId, code, code === 'NO_LIVE' ? 'Publikasi live belum diaktifkan operator.' : 'Kredensial/scope/token Meta Threads belum memadai.');
    return deps.threads.getQueue(queueId);
  }
  const credentials = {
    appId: effective.appId!,
    appSecret: '',
    userId: effective.userId!,
    accessToken: deps.token?.() ?? ''
  };
  if (!credentials.appId || !credentials.userId || !credentials.accessToken) {
    await deps.threads.markFailed(queueId, 'CONFIG', 'THREADS_APP_ID/THREADS_USER_ID/THREADS_ACCESS_TOKEN belum lengkap di server.');
    return deps.threads.getQueue(queueId);
  }

  await deps.threads.recordAttempt({
    queueId, step: 'QUOTA', outcome: 'OK', httpStatus: null
  });
  const limit = await (deps.limit ?? fetchPublishingLimit)({ credentials, transport: deps.transport });
  if (limit.quotaUsage !== null && limit.quotaTotal !== null && limit.remaining === 0) {
    await deps.threads.recordAttempt({ queueId, step: 'QUOTA', outcome: 'BLOCKED', errorCode: 'RATE_LIMIT' });
    await deps.threads.markFailed(queueId, 'RATE_LIMIT', 'Kuota 250 post/24 jam Threads sudah habis.');
    return deps.threads.getQueue(queueId);
  }

  const result = await publishTextPost({ text: draft.text, credentials, transport: deps.transport, sleep: deps.sleep });
  if (result.outcome === 'PUBLISHED') {
    await deps.threads.recordAttempt({
      queueId, step: 'PUBLISH', outcome: 'OK', containerId: result.containerId, mediaId: result.mediaId
    });
    await deps.threads.completePublished(queueId, result.mediaId, await publishedUrlFor(result.mediaId, credentials, deps));
    return deps.threads.getQueue(queueId);
  }
  if (result.outcome === 'FAILED') {
    await deps.threads.recordAttempt({
      queueId, step: 'CREATE_CONTAINER', outcome: 'FAILED', httpStatus: result.httpStatus, errorCode: result.code, error: result.message
    });
    await deps.threads.markFailed(queueId, result.code, result.message);
    return deps.threads.getQueue(queueId);
  }
  if (result.outcome === 'BLOCKED') {
    await deps.threads.recordAttempt({ queueId, step: 'CREATE_CONTAINER', outcome: 'BLOCKED', errorCode: result.code, error: result.message });
    await deps.threads.markFailed(queueId, result.code, result.message);
    return deps.threads.getQueue(queueId);
  }
  // AMBIGUOUS: container mungkin sudah terbit. Rekonsiliasi dulu, jangan kirim ulang.
  await deps.threads.recordAttempt({
    queueId, step: 'PUBLISH', outcome: 'AMBIGUOUS', errorCode: result.code, error: result.message, containerId: result.containerId
  });
  if (result.containerId && claimed.attemptCount < MAX_ATTEMPTS) {
    const status = await (deps.inspect ?? inspectContainer)({ containerId: result.containerId, credentials, transport: deps.transport });
    if (status.status === 'PUBLISHED') {
      await deps.threads.completePublished(queueId, result.containerId, null);
      await deps.threads.recordAttempt({ queueId, step: 'STATUS', outcome: 'DUPLICATE', containerId: result.containerId, mediaId: result.containerId });
      return deps.threads.getQueue(queueId);
    }
    if (status.status === 'ERROR' || status.status === 'EXPIRED') {
      await deps.threads.markFailed(queueId, 'CONTAINER_ERROR', status.errorMessage ?? `Container ${status.status}`);
      return deps.threads.getQueue(queueId);
    }
  }
  await deps.threads.markNeedsReview(queueId, result.code, result.message);
  deps.onAmbiguous?.(claimed, result.code, result.message);
  return deps.threads.getQueue(queueId);
}

/** Dispatcher: antrekan job pg-boss untuk baris QUEUED yang belum diproses.
 * singletonKey pg-boss tidak mencegah duplikat saat dispatcher berjalan tiap detik,
 * jadi cek eksplisit job yang masih aktif — kalau tidak, ribuan job nyangkut. */
export async function dispatchThreadsPublish(
  repo: ThreadsRepository,
  boss: { send: (name: string, data: { queueId: string }, options?: Record<string, unknown>) => Promise<string | null> },
  pool: { query: (text: string, values: unknown[]) => Promise<{ rowCount: number | null }> }
): Promise<void> {
  for (const id of await repo.pendingQueue()) {
    const existing = await pool.query(
      "SELECT 1 FROM pgboss.job WHERE name = $1 AND data->>'queueId' = $2 AND state IN ('created','active','retry') LIMIT 1",
      [THREADS_JOB_NAME, id]
    );
    if (existing.rowCount) continue;
    await boss.send(THREADS_JOB_NAME, { queueId: id }, { singletonKey: id, retryLimit: MAX_ATTEMPTS, retryDelay: 60, retryBackoff: true });
  }
}

export function newQueueId(): string {
  return randomUUID();
}
