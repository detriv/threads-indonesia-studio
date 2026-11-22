import { THREADS_SCOPES } from '@threads-id/contracts';

/** Bangun URL authorize Meta Threads (dipakai API + worker; scope granular resmi). */
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

export const DEFAULT_OAUTH_REDIRECT = 'http://127.0.0.1:8080/api/threads/oauth-callback';
export const DEFAULT_SCOPES = THREADS_SCOPES;
