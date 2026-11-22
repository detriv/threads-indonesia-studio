import { randomUUID } from 'node:crypto';
import { THREADS_REPLY_JOB_NAME } from '@threads-id/contracts';
import type { ReplyQueueItem } from '@threads-id/contracts';
import { threadsEnv, tokenExpired } from '@threads-id/db';
import type { ReplyRepository, ThreadsRepository } from '@threads-id/db';
import type { ThreadsTransport } from './threads-client.js';
import { fetchReplyPublishingLimit, inspectContainer, publishTextPost, refreshLongLivedToken } from './threads-client.js';

const MAX_ATTEMPTS = 3;

/** Dispatcher: antrekan balasan QUEUED ke pg-boss tanpa membanjiri job duplikat. */
export async function dispatchThreadsReplies(
  repo: ReplyRepository,
  boss: { send: (name: string, data: { queueId: string }, options?: Record<string, unknown>) => Promise<string | null> },
  pool: { query: (text: string, values: unknown[]) => Promise<{ rowCount: number | null }> }
): Promise<void> {
  for (const id of await repo.pending()) {
    const existing = await pool.query(
      "SELECT 1 FROM pgboss.job WHERE name = $1 AND data->>'queueId' = $2 AND state IN ('created','active','retry') LIMIT 1",
      [THREADS_REPLY_JOB_NAME, id]
    );
    if (existing.rowCount) continue;
    await boss.send(THREADS_REPLY_JOB_NAME, { queueId: id }, { singletonKey: id, retryLimit: MAX_ATTEMPTS, retryDelay: 60, retryBackoff: true });
  }
}

export type ReplyDeps = {
  replies: ReplyRepository;
  threads: ThreadsRepository;
  /** Live balasan TERPISAH dari live publikasi post. */
  live?: (() => boolean | Promise<boolean>) | undefined;
  transport?: ThreadsTransport | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  inspect?: typeof inspectContainer | undefined;
  limit?: typeof fetchReplyPublishingLimit | undefined;
  token?: (() => string | undefined) | undefined;
  persistToken?: ((token: string) => Promise<void>) | undefined;
};

/**
 * Satu baris balasan: klaim atomik → cek live/kuota/scope → container (reply_to_id) → publish.
 * Ambigu after-send → NEEDS_REVIEW, tidak pernah kirim ulang buta.
 */
export async function processThreadsReply(queueId: string, deps: ReplyDeps): Promise<ReplyQueueItem | null> {
  const settings = await deps.replies.getSettings();
  if (settings.paused) return null; // ditunda; baris tetap QUEUED

  const claimed = await deps.replies.claim(queueId);
  if (!claimed) return null;

  const live = deps.live ? await deps.live() : false;
  if (!live) {
    await deps.replies.markRequiresLive(queueId);
    return deps.replies.get(queueId);
  }

  const connection = await deps.threads.getConnection();
  if (!connection) {
    await deps.replies.markFailed(queueId, 'CONFIG', 'Koneksi Meta Threads belum diatur.');
    return deps.replies.get(queueId);
  }
  const envFallback = threadsEnv();
  const tokenValue = deps.token?.() ?? envFallback.accessToken;
  const effective = {
    ...connection,
    appId: connection.appId ?? envFallback.appId,
    userId: connection.userId ?? envFallback.userId,
    accessTokenPresent: connection.accessTokenPresent || Boolean(tokenValue)
  };
  if (tokenExpired(connection.tokenExpiresAt)) {
    try {
      const refreshed = await refreshLongLivedToken({ accessToken: tokenValue, transport: deps.transport });
      await deps.persistToken?.(refreshed.accessToken);
      const expiresAt = new Date(Date.now() + (refreshed.expiresIn ?? 60 * 24 * 3600) * 1000);
      await deps.threads.updateToken(expiresAt.toISOString());
      deps.token = () => refreshed.accessToken;
    } catch {
      await deps.replies.markFailed(queueId, 'TOKEN_EXPIRED', 'Token kedaluwarsa dan refresh gagal; hubungkan ulang lewat OAuth.');
      return deps.replies.get(queueId);
    }
  }

  const credentials = {
    appId: effective.appId ?? '',
    appSecret: '',
    userId: effective.userId ?? '',
    accessToken: deps.token?.() ?? ''
  };
  const scopes = (effective.scopes ?? '').split(',').map((scope) => scope.trim());
  if (!scopes.includes('threads_manage_replies')) {
    await deps.replies.markFailed(queueId, 'SCOPE_MISSING', 'Token belum punya threads_manage_replies; ulangi OAuth di dashboard.');
    return deps.replies.get(queueId);
  }
  if (!credentials.appId || !credentials.userId || !credentials.accessToken) {
    await deps.replies.markFailed(queueId, 'CONFIG', 'Kredensial Meta Threads belum lengkap di server.');
    return deps.replies.get(queueId);
  }

  const limit = await (deps.limit ?? fetchReplyPublishingLimit)({ credentials, transport: deps.transport });
  await deps.replies.syncQuota(limit.quotaUsage, limit.quotaTotal);
  await deps.replies.recordAttempt({ id: randomUUID(), queueId, step: 'QUOTA', outcome: 'OK' });
  if (limit.remaining !== null && limit.remaining <= 0) {
    await deps.replies.recordAttempt({ id: randomUUID(), queueId, step: 'QUOTA', outcome: 'BLOCKED', errorCode: 'RATE_LIMIT' });
    await deps.replies.markFailed(queueId, 'RATE_LIMIT', 'Kuota balasan Meta (1.000/24 jam) sudah habis.');
    return deps.replies.get(queueId);
  }

  const result = await publishTextPost({
    text: claimed.text,
    replyToId: claimed.replyToId,
    credentials,
    transport: deps.transport,
    sleep: deps.sleep
  });

  if (result.outcome === 'PUBLISHED') {
    await deps.replies.recordAttempt({ id: randomUUID(), queueId, step: 'PUBLISH', outcome: 'OK', containerId: result.containerId, mediaId: result.mediaId });
    await deps.replies.markReplied(queueId, result.mediaId);
    return deps.replies.get(queueId);
  }
  if (result.outcome === 'FAILED' || result.outcome === 'BLOCKED') {
    await deps.replies.recordAttempt({ id: randomUUID(), queueId, step: 'CREATE_CONTAINER', outcome: 'FAILED', errorCode: result.code, error: result.message });
    await deps.replies.markFailed(queueId, result.code, result.message);
    return deps.replies.get(queueId);
  }

  // AMBIGUOUS: container mungkin sudah terbit → rekonsiliasi, jangan kirim ulang.
  await deps.replies.recordAttempt({ id: randomUUID(), queueId, step: 'PUBLISH', outcome: 'AMBIGUOUS', errorCode: result.code, error: result.message, containerId: result.containerId });
  if (result.containerId && claimed.attemptCount < MAX_ATTEMPTS) {
    const status = await (deps.inspect ?? inspectContainer)({ containerId: result.containerId, credentials, transport: deps.transport });
    if (status.status === 'PUBLISHED') {
      await deps.replies.markReplied(queueId, result.containerId);
      await deps.replies.recordAttempt({ id: randomUUID(), queueId, step: 'STATUS', outcome: 'DUPLICATE', containerId: result.containerId, mediaId: result.containerId });
      return deps.replies.get(queueId);
    }
    if (status.status === 'ERROR' || status.status === 'EXPIRED') {
      await deps.replies.markFailed(queueId, 'CONTAINER_ERROR', status.errorMessage ?? `Container ${status.status}`);
      return deps.replies.get(queueId);
    }
  }
  await deps.replies.markNeedsReview(queueId, result.code, result.message);
  throw new Error('Balasan ambigu; menunggu rekonsiliasi operator');
}
