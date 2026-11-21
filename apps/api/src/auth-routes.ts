import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hashSessionToken } from '@threads-id/db';
import { loginRequestSchema } from '@threads-id/contracts';
import type { RateLimiter } from './rate-limit.js';

export type AuthLike = {
  verifyCredentials(username: string, password: string): Promise<boolean>;
  createSession(tokenHash: string, csrfToken: string, expiresAt: Date, username: string): Promise<void>;
  findSession(tokenHash: string): Promise<{ csrfToken: string; expiresAt: Date; username: string } | null>;
  deleteSession(tokenHash: string): Promise<void>;
};

export type SessionInfo = { username: string; csrfToken: string; expiresAt: Date; tokenHash: string };

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionInfo;
  }
}

export function registerAuthRoutes(app: FastifyInstance, opts: {
  auth: AuthLike;
  sessionTtlMs: number;
  cookieSecure: boolean;
  rateLimiter: RateLimiter;
}): void {
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Username dan password wajib diisi' });
    const { username, password } = parsed.data;
    const key = `${request.ip}|${username}`;
    const limit = opts.rateLimiter.check(key);
    if (!limit.allowed) {
      reply.header('retry-after', String(limit.retryAfterSeconds));
      return reply.code(429).send({ error: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
    }
    const valid = await opts.auth.verifyCredentials(username, password);
    if (!valid) {
      opts.rateLimiter.recordFailure(key);
      return reply.code(401).send({ error: 'Kredensial tidak valid' });
    }
    opts.rateLimiter.reset(key);
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + opts.sessionTtlMs);
    await opts.auth.createSession(hashSessionToken(token), csrfToken, expiresAt, username);
    const maxAge = Math.floor(opts.sessionTtlMs / 1000);
    reply.setCookie('sid', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: opts.cookieSecure, maxAge });
    reply.setCookie('csrf', csrfToken, { path: '/', httpOnly: false, sameSite: 'lax', secure: opts.cookieSecure, maxAge });
    return { ok: true, username, expiresAt: expiresAt.toISOString() };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.session) await opts.auth.deleteSession(request.session.tokenHash);
    reply.clearCookie('sid', { path: '/' });
    reply.clearCookie('csrf', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/session', async (request) => {
    const token = request.cookies.sid;
    if (!token) return { authenticated: false };
    const session = await opts.auth.findSession(hashSessionToken(token));
    if (!session) return { authenticated: false };
    return { authenticated: true, username: session.username, expiresAt: session.expiresAt.toISOString() };
  });
}
