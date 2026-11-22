import type { FastifyInstance } from 'fastify';
import type { TrendRepository } from '@threads-id/db';
import { randomUUID } from 'node:crypto';
import { trendSettingsSchema } from '@threads-id/contracts';

/** Fase 4A: discovery tren, kandidat, dan pengaturan sumber/ambang. */
export async function registerTrendRoutes(app: FastifyInstance, trends: TrendRepository): Promise<void> {
  app.get('/api/trends/settings', async () => trends.getSettings());

  app.patch('/api/trends/settings', async (request, reply) => {
    const parsed = trendSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Pengaturan tren tidak valid', detail: parsed.error.issues });
    return trends.updateSettings(parsed.data);
  });

  app.get('/api/trends/items', async () => trends.listRecentItems(50));

  app.get('/api/trends/candidates', async () => trends.listCandidates(50));

  app.post('/api/trends/refresh', async (request, reply) => {
    const runId = randomUUID();
    await trends.createRun(runId, request.session?.username ?? null);
    return reply.code(202).send({ runId, status: 'QUEUED' });
  });

  app.get<{ Params: { id: string } }>('/api/trends/runs/:id', async (request, reply) => {
    const run = await trends.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'Run discovery tidak ditemukan.' });
    return run;
  });

  app.post<{ Params: { id: string } }>('/api/trends/candidates/:id/dismiss', async (request, reply) => {
    const candidate = (await trends.listCandidates(500)).find((item) => item.id === request.params.id);
    if (!candidate) return reply.code(404).send({ error: 'Kandidat tidak ditemukan.' });
    await trends.dismissCandidate(candidate.id);
    return { ok: true, id: candidate.id };
  });
}
