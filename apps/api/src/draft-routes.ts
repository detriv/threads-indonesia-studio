import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DraftCancelledError, DraftLockedError, DraftStateError, TrendSourcesError } from '@threads-id/db';
import type { DraftRepository, EditorialRepository } from '@threads-id/db';
import { contentFormatSchema, draftStatusSchema, trendSourcesComplete } from '@threads-id/contracts';

const draftCreateSchema = z.object({
  themeId: z.uuid(),
  format: contentFormatSchema,
  text: z.string().trim().min(1),
  sourceUrl: z.url().nullable().optional(),
  sourceTime: z.iso.datetime().nullable().optional(),
  relevanceNote: z.string().trim().min(1).nullable().optional(),
  personalSourceId: z.uuid().nullable().optional()
});
const draftPatchSchema = z.object({
  themeId: z.uuid().optional(),
  format: contentFormatSchema.optional(),
  text: z.string().trim().min(1).optional(),
  sourceUrl: z.url().nullable().optional(),
  sourceTime: z.iso.datetime().nullable().optional(),
  relevanceNote: z.string().trim().min(1).nullable().optional(),
  personalSourceId: z.uuid().nullable().optional(),
  expectedVersion: z.number().int().positive().optional()
});
const lockSchema = z.object({ locked: z.boolean() });
const reviewSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().min(1).optional() });
const listQuerySchema = z.object({
  status: draftStatusSchema.optional(),
  themeId: z.uuid().optional(),
  format: contentFormatSchema.optional()
});

function draftErrorResponse(error: unknown, reply: FastifyReply): unknown {
  if (error instanceof DraftLockedError) return reply.code(423).send({ error: error.message });
  if (error instanceof DraftCancelledError) return reply.code(409).send({ error: error.message });
  if (error instanceof TrendSourcesError) return reply.code(400).send({ error: error.message });
  if (error instanceof DraftStateError) return reply.code(400).send({ error: error.message });
  if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503') {
    return reply.code(400).send({ error: 'Referensi tema atau sumber pengalaman tidak ditemukan' });
  }
  throw error;
}

export function registerDraftRoutes(app: FastifyInstance, drafts: DraftRepository, editorial: EditorialRepository): void {
  app.get('/api/drafts', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filter draft tidak valid' });
    return drafts.list(parsed.data);
  });

  app.get('/api/review', async () => drafts.list({ status: 'IN_REVIEW' }));

  app.post('/api/drafts', async (request, reply) => {
    const parsed = draftCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Data draft tidak valid', detail: parsed.error.issues });
    const data = parsed.data;
    if (!(await editorial.getTheme(data.themeId))) return reply.code(400).send({ error: 'Tema tidak ditemukan' });
    if (data.personalSourceId) {
      const sources = await editorial.listPersonalSources();
      if (!sources.some((s) => s.id === data.personalSourceId)) return reply.code(400).send({ error: 'Sumber pengalaman pribadi harus berasal dari catatan pemilik yang tersimpan' });
    }
    if (data.format === 'TREN_RELEVAN' && !trendSourcesComplete({ format: data.format, sourceUrl: data.sourceUrl ?? null, sourceTime: data.sourceTime ?? null, relevanceNote: data.relevanceNote ?? null })) {
      return reply.code(400).send({ error: new TrendSourcesError().message });
    }
    try {
      return reply.code(201).send(await drafts.create(data));
    } catch (error) {
      return draftErrorResponse(error, reply);
    }
  });

  app.get<{ Params: { id: string } }>('/api/drafts/:id', async (request, reply) => {
    const draft = await drafts.get(request.params.id);
    return draft ?? reply.code(404).send({ error: 'Draft tidak ditemukan' });
  });

  app.patch<{ Params: { id: string } }>('/api/drafts/:id', async (request, reply) => {
    const parsed = draftPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Perubahan draft tidak valid', detail: parsed.error.issues });
    try {
      return await drafts.update(request.params.id, parsed.data, parsed.data.expectedVersion);
    } catch (error) {
      return draftErrorResponse(error, reply);
    }
  });

  app.post<{ Params: { id: string } }>('/api/drafts/:id/lock', async (request, reply) => {
    const parsed = lockSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Payload kunci harus { locked: boolean }' });
    const draft = await drafts.setLocked(request.params.id, parsed.data.locked);
    return draft ?? reply.code(404).send({ error: 'Draft tidak ditemukan' });
  });

  app.post<{ Params: { id: string } }>('/api/drafts/:id/review', async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Keputusan review harus APPROVE atau REJECT' });
    try {
      return await drafts.review(request.params.id, parsed.data.decision, parsed.data.note);
    } catch (error) {
      return draftErrorResponse(error, reply);
    }
  });

  app.post<{ Params: { id: string } }>('/api/drafts/:id/cancel', async (request, reply) => {
    try {
      return await drafts.cancel(request.params.id);
    } catch (error) {
      return draftErrorResponse(error, reply);
    }
  });
}
