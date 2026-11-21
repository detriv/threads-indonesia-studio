import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ScheduleRepository } from '@threads-id/db';
import { contentFormatSchema, executionStatusSchema, PHASE1_INTEGRATION_STATUS } from '@threads-id/contracts';

const historyQuerySchema = z.object({
  status: executionStatusSchema.optional(),
  themeId: z.uuid().optional(),
  format: contentFormatSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

export function registerHistoryRoutes(app: FastifyInstance, schedule: ScheduleRepository): void {
  app.get('/api/history', async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filter riwayat tidak valid' });
    return schedule.listExecutions(parsed.data);
  });

  app.get('/api/integrations', async () => PHASE1_INTEGRATION_STATUS);
}
