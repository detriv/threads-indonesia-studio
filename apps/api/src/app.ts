import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { DEMO_EDITORIAL_SAMPLE, DEMO_JOB_NAME } from '@threads-id/contracts';
import type { DemoAction, DemoJobData } from '@threads-id/contracts';

type Repo = {
  create(id: string): Promise<void>;
  get(id: string): Promise<DemoAction | Record<string, unknown> | null>;
  list(): Promise<Array<DemoAction | Record<string, unknown>>>;
  fail?: (id: string, error: string) => Promise<void>;
};
type Queue = { send(name: string, data: DemoJobData, options?: Record<string, unknown>): Promise<string | null> };

export function buildApp(deps: { repo: Repo; queue: Queue }) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', async () => ({ ok: true, service: 'api', demo: true }));
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
