import { THREADS_BASE_URL, THREADS_MAX_TEXT, THREADS_STATUS_POLL_MAX } from '@threads-id/contracts';
import { tokenExpired } from '@threads-id/db';
import type { ThreadsConnection } from '@threads-id/db';

export type ThreadsCredentials = {
  appId: string; appSecret: string; userId: string; accessToken: string;
};

export type ThreadsTransport = typeof fetch;

export type PublishResult =
  | { outcome: 'PUBLISHED'; mediaId: string; containerId: string }
  | { outcome: 'AMBIGUOUS'; code: string; message: string; containerId: string | null }
  | { outcome: 'FAILED'; code: string; message: string; httpStatus: number | null }
  | { outcome: 'BLOCKED'; code: string; message: string };

export type PublishTextPostInput = {
  text: string;
  credentials: ThreadsCredentials;
  transport?: ThreadsTransport | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

export type InspectContainerInput = {
  containerId: string;
  credentials: ThreadsCredentials;
  transport?: ThreadsTransport | undefined;
  polls?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

export type PublishingLimitInput = {
  credentials: ThreadsCredentials;
  transport?: ThreadsTransport | undefined;
};

const ERROR_TEXT: Record<string, string> = {
  CONFIG: 'Kredensial Meta Threads belum lengkap.',
  NO_LIVE: 'Publikasi live belum diaktifkan operator.',
  TOKEN_EXPIRED: 'Token Threads kedaluwarsa; muat ulang lewat OAuth.',
  SCOPE_MISSING: 'Token Threads tidak membawa threads_basic + threads_content_publish.',
  RATE_LIMIT: 'Meta membatasi permintaan (rate limit / kuota 250 post per 24 jam).',
  TEXT_TOO_LONG: `Teks melebihi ${THREADS_MAX_TEXT} karakter.`,
  PROVIDER: 'Meta Threads menolak permintaan.',
  CONTAINER_ERROR: 'Container Threads gagal diproses Meta.'
};
const ERROR_DEFAULT = ERROR_TEXT.PROVIDER ?? 'Meta Threads menolak permintaan.';

/** Bangun URL authorize Meta Threads (OAuth 2.0, scope granular). */
export function buildAuthorizeUrl(input: { appId: string; redirectUri: string; state: string; scopes: readonly string[] }): string {
  if (!input.appId) throw new Error('CONFIG');
  const params = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(','),
    response_type: 'code',
    state: input.state
  });
  return `https://threads.com/oauth/authorize?${params.toString()}`;
}

export function assertLiveAllowed(connection: ThreadsConnection): void {
  if (!connection.livePosting) throw new Error('NO_LIVE');
  if (!connection.appId || !connection.appSecretPresent || !connection.userId || !connection.accessTokenPresent) {
    throw new Error('CONFIG');
  }
  if (tokenExpired(connection.tokenExpiresAt)) throw new Error('TOKEN_EXPIRED');
  const scopes = (connection.scopes ?? '').split(',').map((s) => s.trim());
  if (!scopes.includes('threads_basic') || !scopes.includes('threads_content_publish')) throw new Error('SCOPE_MISSING');
}

/** Teks divalidasi di aplikasi sebelum panggilan API.
 * Meta membatasi 500 "karakter" di mana emoji dihitung sebagai jumlah byte UTF-8,
 * jadi penegakan memakai octet/byte length, bukan jumlah kodepoint. */
export function assertTextWithinLimit(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > THREADS_MAX_TEXT) throw new Error('TEXT_TOO_LONG');
}

type GraphError = { error?: { code?: number; error_subcode?: number; message?: unknown }; message?: unknown };

function classify(status: number | null, body: unknown): { code: string; message: string } {
  const detail = (body ?? {}) as Partial<GraphError>;
  const raw = detail.error?.message ?? detail.message ?? '';
  const message = typeof raw === 'string' ? raw : '';
  if (status === 429) return { code: 'RATE_LIMIT', message: ERROR_TEXT.RATE_LIMIT ?? ERROR_DEFAULT };
  if (status === 400 && /Matching code was not found|was already used/i.test(message)) {
    return { code: 'PROVIDER', message: 'Kode OAuth tidak berlaku atau sudah dipakai.' };
  }
  if (status === 403) return { code: 'SCOPE_MISSING', message: ERROR_TEXT.SCOPE_MISSING ?? ERROR_DEFAULT };
  if (status === 401) return { code: 'TOKEN_EXPIRED', message: ERROR_TEXT.TOKEN_EXPIRED ?? ERROR_DEFAULT };
  return { code: 'PROVIDER', message: message || ERROR_DEFAULT };
}

function form(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

/**
 * Alur dua langkah Meta: buat container teks → tunggu ~30 detik → publish.
 * Timeout/kesalahan jaringan setelah panggilan yang mungkin berhasil = AMBIGUOUS (NEEDS_REVIEW),
 * bukan kegagalan biasa: tidak ada pengiriman ulang otomatis.
 */
export async function publishTextPost(input: PublishTextPostInput): Promise<PublishResult> {
  const transport = input.transport ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  assertTextWithinLimit(input.text);
  const { userId, accessToken } = input.credentials;
  if (!userId || !accessToken) throw new Error('CONFIG');

  let containerResponse: Response;
  try {
    containerResponse = await transport(`${THREADS_BASE_URL}/${userId}/threads`, {
      method: 'POST',
      body: form({ media_type: 'TEXT', text: input.text, access_token: accessToken }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    // Container mungkin sudah dibuat di Meta sebelum koneksi putus → ambigu, jangan kirim ulang.
    return { outcome: 'AMBIGUOUS', code: name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', message: `Pembuatan container tidak pasti: ${name || 'network error'}`, containerId: null };
  }
  if (!containerResponse.ok) {
    const body = await safeJson(containerResponse);
    const { code, message } = classify(containerResponse.status, body);
    return { outcome: 'FAILED', code, message, httpStatus: containerResponse.status };
  }
  const containerBody = await safeJson(containerResponse) as { id?: string };
  const containerId = containerBody?.id;
  if (!containerId) return { outcome: 'AMBIGUOUS', code: 'NO_CONTAINER_ID', message: 'Meta tidak mengembalikan ID container.', containerId: null };

  // Meta merekomendasikan ~30 detik agar container selesai diproses.
  await sleep(30_000);

  let publishResponse: Response;
  try {
    publishResponse = await transport(`${THREADS_BASE_URL}/${userId}/threads_publish`, {
      method: 'POST',
      body: form({ creation_id: containerId, access_token: accessToken }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    // Container bisa saja sudah/live: status ambigu sampai direkonsiliasi operator.
    return { outcome: 'AMBIGUOUS', code: name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', message: `Publish tidak pasti setelah container ${containerId}: ${name || 'network error'}`, containerId };
  }
  if (!publishResponse.ok) {
    const body = await safeJson(publishResponse);
    const { code, message } = classify(publishResponse.status, body);
    return { outcome: 'FAILED', code, message, httpStatus: publishResponse.status };
  }
  const publishBody = await safeJson(publishResponse) as { id?: string };
  if (!publishBody?.id) {
    return { outcome: 'AMBIGUOUS', code: 'NO_MEDIA_ID', message: 'Meta tidak mengembalikan media ID.', containerId };
  }
  return { outcome: 'PUBLISHED', mediaId: publishBody.id, containerId };
}

/** Rekonsiliasi setelah publish ambigu: cek status container (IN_PROGRESS/FINISHED/PUBLISHED/ERROR/EXPIRED). */
export async function inspectContainer(input: InspectContainerInput): Promise<{ status: string; errorMessage: string | null; mediaId: string | null }> {
  const transport = input.transport ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const polls = Math.min(Math.max(input.polls ?? THREADS_STATUS_POLL_MAX, 1), THREADS_STATUS_POLL_MAX);
  let last = { status: 'UNKNOWN', errorMessage: null as string | null, mediaId: null as string | null };
  for (let attempt = 0; attempt < polls; attempt += 1) {
    try {
      const response = await transport(
        `${THREADS_BASE_URL}/${input.containerId}?fields=status,error_message&access_token=${encodeURIComponent(input.credentials.accessToken)}`,
        { signal: AbortSignal.timeout(30_000) }
      );
      const body = await safeJson(response) as { status?: string; error_message?: string };
      last = { status: body?.status ?? 'UNKNOWN', errorMessage: body?.error_message ?? null, mediaId: input.containerId };
    } catch {
      // Polling gagal tidak mengubah status tersimpan; operator tetap melihat NEEDS_REVIEW.
    }
    if (['PUBLISHED', 'ERROR', 'EXPIRED'].includes(last.status)) break;
    if (attempt < polls - 1) await sleep(60_000);
  }
  return last;
}

/** Kuota 250 post/24 jam: dibaca sebelum publish agar tidak percuma membuat container. */
export async function fetchPublishingLimit(input: PublishingLimitInput): Promise<{ quotaUsage: number | null; quotaTotal: number | null; remaining: number | null }> {
  const transport = input.transport ?? fetch;
  try {
    const response = await transport(
      `${THREADS_BASE_URL}/${input.credentials.userId}/threads_publishing_limit?fields=quota_usage,config&access_token=${encodeURIComponent(input.credentials.accessToken)}`,
      { signal: AbortSignal.timeout(30_000) }
    );
    const body = await safeJson(response) as {
      data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>;
      quota_usage?: number; config?: { quota_total?: number };
    };
    // Dokumentasi Meta: respons dibungkus {"data":[{...}]}. Terima juga bentuk tanpa pembungkus.
    const entry = Array.isArray(body?.data) ? body.data[0] : body;
    const quotaUsage = typeof entry?.quota_usage === 'number' ? entry.quota_usage : null;
    const quotaTotal = typeof entry?.config?.quota_total === 'number' ? entry.config.quota_total : null;
    return { quotaUsage, quotaTotal, remaining: quotaUsage === null || quotaTotal === null ? null : Math.max(0, quotaTotal - quotaUsage) };
  } catch {
    return { quotaUsage: null, quotaTotal: null, remaining: null };
  }
}

/** Perbarui token long-lived (60 hari) sebelum kedaluwarsa.
 * Meta: GET /refresh_access_token?grant_type=th_refresh_token&access_token=... (tanpa client_secret). */
export async function refreshLongLivedToken(input: {
  accessToken: string;
  transport?: ThreadsTransport | undefined;
}): Promise<{ accessToken: string; expiresIn: number | null }> {
  const transport = input.transport ?? fetch;
  let response: Response;
  try {
    response = await transport(
      `https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(input.accessToken)}`,
      { signal: AbortSignal.timeout(30_000) }
    );
  } catch {
    throw new Error('PROVIDER');
  }
  const body = await safeJson(response) as { access_token?: string; expires_in?: number; error_message?: string };
  if (!response.ok || !body?.access_token) throw new Error('PROVIDER');
  return { accessToken: body.access_token, expiresIn: typeof body.expires_in === 'number' ? body.expires_in : null };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
