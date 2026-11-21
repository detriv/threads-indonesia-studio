export type RateLimiter = {
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
  recordFailure(key: string): void;
  reset(key: string): void;
};

/** Rate limit login in-memory per kunci (IP|username). Cukup untuk satu instance API lokal. */
export function createRateLimiter(options: { maxAttempts?: number; windowMs?: number } = {}): RateLimiter {
  const maxAttempts = options.maxAttempts ?? 5;
  const windowMs = options.windowMs ?? 15 * 60_000;
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key) {
      const entry = hits.get(key);
      const now = Date.now();
      if (entry && now < entry.resetAt && entry.count >= maxAttempts) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    recordFailure(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || now >= entry.resetAt) hits.set(key, { count: 1, resetAt: now + windowMs });
      else entry.count += 1;
    },
    reset(key) {
      hits.delete(key);
    }
  };
}
