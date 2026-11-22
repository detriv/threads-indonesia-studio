import { randomUUID } from 'node:crypto';
import { REPLY_INBOX_JOB_NAME } from '@threads-id/contracts';
import type { ReplyInboxRun } from '@threads-id/contracts';
import type { EditorialRepository, ReplyRepository, ThreadsRepository } from '@threads-id/db';
import type { ThreadsCredentials, ThreadsTransport } from './threads-client.js';
import { threadsEnv, tokenExpired } from '@threads-id/db';

const MAX_ATTEMPTS = 3;

/** Dispatcher: antrekan run inbox QUEUED ke pg-boss tanpa membanjiri job duplikat. */
export async function dispatchReplyInbox(
  repo: ReplyRepository,
  boss: { send: (name: string, data: { runId: string }, options?: Record<string, unknown>) => Promise<string | null> },
  pool: { query: (text: string, values: unknown[]) => Promise<{ rowCount: number | null }> }
): Promise<void> {
  for (const runId of await repo.pendingInboxRuns()) {
    const existing = await pool.query(
      "SELECT 1 FROM pgboss.job WHERE name = $1 AND data->>'runId' = $2 AND state IN ('created','active','retry') LIMIT 1",
      [REPLY_INBOX_JOB_NAME, runId]
    );
    if (existing.rowCount) continue;
    await boss.send(REPLY_INBOX_JOB_NAME, { runId }, { singletonKey: runId, retryLimit: MAX_ATTEMPTS, retryDelay: 30, retryBackoff: true });
  }
}

export type InboxDeps = {
  replies: ReplyRepository;
  threads: ThreadsRepository;
  editorial: EditorialRepository;
  transport?: ThreadsTransport | undefined;
  token?: (() => string | undefined) | undefined;
  /** Auto-draft opsional (AI). Boleh ditolak → draft dibiarkan kosong, tidak dipaksakan. */
  draft?: ((inbound: { username: string | null; text: string }) => Promise<string | null>) | undefined;
};

type InboxResult = { runId: string; posts: number; candidates: number; newItems: number; drafts: number; failures: string[] };

/**
 * Tarik balasan dari postingan kita (GET /me/threads → GET /{post-id}/replies).
 * Hanya balasan orang lain yang disimpan; balasan milik kita sendiri dilewati.
 */
export async function processReplyInbox(data: ReplyInboxRun, deps: InboxDeps): Promise<InboxResult> {
  const connection = await deps.threads.getConnection();
  if (!connection?.userId) throw new Error('Koneksi Meta Threads belum ada.');
  const credentials: ThreadsCredentials = {
    appId: connection.appId ?? threadsEnv().appId,
    appSecret: '',
    userId: connection.userId,
    accessToken: deps.token?.() ?? threadsEnv().accessToken
  };
  if (!credentials.appId || !credentials.accessToken) throw new Error('Kredensial Meta Threads belum lengkap.');
  if (tokenExpired(connection.tokenExpiresAt)) throw new Error('Token kedaluwarsa; hubungkan ulang lewat OAuth.');

  const transport = deps.transport ?? fetch;
  const result: InboxResult = { runId: data.runId, posts: 0, candidates: 0, newItems: 0, drafts: 0, failures: [] };

  const postsResponse = await transport(
    `https://graph.threads.com/v1.0/me/threads?fields=id,text,permalink,timestamp&limit=20&access_token=${encodeURIComponent(credentials.accessToken)}`,
    { signal: AbortSignal.timeout(30_000) }
  );
  if (!postsResponse.ok) throw new Error(`Meta menolak daftar post: HTTP ${postsResponse.status}`);
  const postsBody = await postsResponse.json() as { data?: Array<{ id: string }> };
  const postIds = (postsBody.data ?? []).map((post) => post.id).filter(Boolean);
  result.posts = postIds.length;

  for (const postId of postIds) {
    try {
      const response = await transport(
        `https://graph.threads.com/v1.0/${postId}/replies?fields=id,text,username,timestamp,is_reply_owned_by_me&limit=50&access_token=${encodeURIComponent(credentials.accessToken)}`,
        { signal: AbortSignal.timeout(30_000) }
      );
      if (!response.ok) { result.failures.push(`post ${postId}: HTTP ${response.status}`); continue; }
      const body = await response.json() as {
        data?: Array<{ id: string; text?: string; username?: string | null; is_reply_owned_by_me?: boolean }>;
      };
      for (const reply of body.data ?? []) {
        if (!reply.id || reply.is_reply_owned_by_me === true) continue;
        result.candidates += 1;
        const id = randomUUID();
        if (!(await deps.replies.insertInbox({
          id, replyMediaId: reply.id, rootPostId: postId, username: reply.username ?? null, text: reply.text ?? '(tanpa teks)'
        }))) continue;
        result.newItems += 1;
        if (!deps.draft) continue;
        try {
          const draft = await deps.draft({ username: reply.username ?? null, text: reply.text ?? '' });
          if (draft) { await deps.replies.setInboxDraft(id, draft); result.drafts += 1; }
        } catch { /* auto-draft gagal tidak menghalangi; operator tetap bisa menulis manual */ }
      }
    } catch (cause) {
      result.failures.push(`post ${postId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return result;
}
