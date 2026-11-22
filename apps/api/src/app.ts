import { registerGenerationRoutes } from './generation-routes.js';
import type { GenerationRepository } from '@threads-id/db';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { hashSessionToken } from '@threads-id/db';
import type { DraftRepository, EditorialRepository, ScheduleRepository, ThreadsRepository } from '@threads-id/db';
import { DEMO_EDITORIAL_SAMPLE, DEMO_JOB_NAME } from '@threads-id/contracts';
import type { DemoAction, DemoJobData } from '@threads-id/contracts';
import { registerAuthRoutes, type AuthLike } from './auth-routes.js';
import { registerEditorialRoutes } from './editorial-routes.js';
import { registerDraftRoutes } from './draft-routes.js';
import { registerScheduleRoutes } from './schedule-routes.js';
import { registerHistoryRoutes } from './history-routes.js';
import { registerThreadsRoutes } from './threads-routes.js';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

type Repo = {
  create(id: string): Promise<void>;
  get(id: string): Promise<DemoAction | Record<string, unknown> | null>;
  list(): Promise<Array<DemoAction | Record<string, unknown>>>;
  fail?: (id: string, error: string) => Promise<void>;
};
type Queue = { send(name: string, data: DemoJobData, options?: Record<string, unknown>): Promise<string | null> };

export type AppDeps = {
  repo: Repo;
  queue: Queue;
  auth: AuthLike;
  editorial?: EditorialRepository;
  generation?: GenerationRepository;
  drafts?: DraftRepository;
  schedule?: ScheduleRepository;
  threads?: ThreadsRepository;
  sessionTtlMs?: number;
  cookieSecure?: boolean;
  rateLimiter?: RateLimiter;
  logger?: FastifyServerOptions['logger'];
};

const REDACT_PATHS = ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers.authorization'];

export function buildApp(deps: AppDeps) {
  const baseLogger = deps.logger ?? (process.env.NODE_ENV !== 'test');
  const logger = typeof baseLogger === 'object' && baseLogger !== null
    ? { ...baseLogger, redact: REDACT_PATHS }
    : baseLogger;
  const app = Fastify({ logger });
  void app.register(cookie);

  const sessionTtlMs = deps.sessionTtlMs ?? 12 * 3600_000;
  registerAuthRoutes(app, {
    auth: deps.auth,
    sessionTtlMs,
    cookieSecure: deps.cookieSecure ?? false,
    rateLimiter: deps.rateLimiter ?? createRateLimiter()
  });

  // Semua rute /api wajib session admin, kecuali login dan status session.
  // Mutasi juga wajib header CSRF yang cocok dengan session.
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url ?? '';
    if (!route.startsWith('/api/')) return;
    if (route === '/api/auth/login' || route === '/api/auth/session') return;
    // Redirect OAuth Meta bersifat publik: code sekali pakai, ditukar server-side.
    if (route === '/api/threads/oauth-callback' && request.method === 'GET') return;
    const token = request.cookies.sid;
    const session = token ? await deps.auth.findSession(hashSessionToken(token)) : null;
    if (!token || !session) return reply.code(401).send({ error: 'Autentikasi diperlukan' });
    request.session = { username: session.username, csrfToken: session.csrfToken, expiresAt: session.expiresAt, tokenHash: hashSessionToken(token) };
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const header = request.headers['x-csrf-token'];
      if (typeof header !== 'string' || header !== session.csrfToken) {
        return reply.code(403).send({ error: 'Token CSRF tidak valid' });
      }
    }
  });

  app.get('/health', async () => ({ ok: true, service: 'api', demo: true }));
  if (deps.generation) registerGenerationRoutes(app,deps.generation);
  if (deps.editorial) registerEditorialRoutes(app, deps.editorial);
  if (deps.editorial && deps.drafts) registerDraftRoutes(app, deps.drafts, deps.editorial);
  if (deps.schedule) registerScheduleRoutes(app, deps.schedule);
  if (deps.schedule) registerHistoryRoutes(app, deps.schedule, { threads: deps.threads });
  if (deps.threads) registerThreadsRoutes(app, deps.threads);
  app.post('/api/demo/actions', async (_request, reply) => {
    const actionId = randomUUID();
    await deps.repo.create(actionId);
    try {
      const jobId = await deps.queue.send(
        DEMO_JOB_NAME,
        { actionId, sample: DEMO_EDITORIAL_SAMPLE },
        { singletonKey: actionId }
      );
      if (!jobId) throw new Error('Antrean menolak job demo');
    } catch (error) {
      await deps.repo.fail?.(actionId, error instanceof Error ? error.message : 'Gagal mengantrekan job');
      throw error;
    }
    return reply.code(202).send({ actionId, status: 'QUEUED', demo: true });
  });
  app.get('/api/demo/actions', async () => deps.repo.list());
  app.get<{ Params: { id: string } }>('/api/demo/actions/:id', async (request, reply) => {
    const action = await deps.repo.get(request.params.id);
    return action ?? reply.code(404).send({ error: 'Aksi demo tidak ditemukan' });
  });
  return app;
}
