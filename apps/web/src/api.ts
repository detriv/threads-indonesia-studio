type ApiOptions = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

function csrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('csrf='));
  return cookie ? decodeURIComponent(cookie.slice('csrf='.length)) : null;
}

export async function apiRequest<T>(url: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === 'string') body = options.body;
    else {
      body = JSON.stringify(options.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = csrfCookie();
    if (csrf) headers.set('x-csrf-token', csrf);
  }
  const response = await fetch(url, { method, body, headers, credentials: 'same-origin', signal: options.signal });
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `Permintaan gagal (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}
