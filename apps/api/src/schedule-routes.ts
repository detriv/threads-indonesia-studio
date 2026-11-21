import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DailyLimitError, ScheduleConflictError, ScheduleStateError } from '@threads-id/db';
import type { ScheduleRepository } from '@threads-id/db';
import { scheduleStatusSchema } from '@threads-id/contracts';

const createSchema = z.object({ draftId: z.uuid(), scheduledAt: z.iso.datetime() });
const rescheduleSchema = z.object({ scheduledAt: z.iso.datetime() });
const listQuerySchema = z.object({
  status: scheduleStatusSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional()
});

function scheduleErrorResponse(error: unknown, reply: FastifyReply): unknown {
  if (error instanceof DailyLimitError) return reply.code(400).send({ error: error.message });
  if (error instanceof ScheduleConflictError) return reply.code(409).send({ error: error.message });
  if (error instanceof ScheduleStateError) return reply.code(400).send({ error: error.message });
  throw error;
}

export function registerScheduleRoutes(app: FastifyInstance, schedule: ScheduleRepository): void {
  app.get('/api/schedule', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filter jadwal tidak valid' });
    return schedule.list(parsed.data);
  });

  app.get<{ Params: { id: string } }>('/api/schedule/:id', async (request, reply) => {
    const entry = await schedule.get(request.params.id);
    return entry ?? reply.code(404).send({ error: 'Jadwal tidak ditemukan' });
  });

  app.post('/api/schedule', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Payload jadwal tidak valid (draftId + scheduledAt ISO UTC)' });
    try {
      return reply.code(201).send(await schedule.create(parsed.data.draftId, new Date(parsed.data.scheduledAt)));
    } catch (error) {
      return scheduleErrorResponse(error, reply);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/schedule/:id', async (request, reply) => {
    const parsed = rescheduleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Payload jadwal ulang tidak valid (scheduledAt ISO UTC)' });
    try {
      return await schedule.reschedule(request.params.id, new Date(parsed.data.scheduledAt));
    } catch (error) {
      return scheduleErrorResponse(error, reply);
    }
  });

  app.post<{ Params: { id: string } }>('/api/schedule/:id/cancel', async (request, reply) => {
    try {
      return await schedule.cancel(request.params.id);
    } catch (error) {
      return scheduleErrorResponse(error, reply);
    }
  });
}
