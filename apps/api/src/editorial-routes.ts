import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EditorialRepository } from '@threads-id/db';
import { formatMixSchema, presetThemeSchema, settingsSchema } from '@threads-id/contracts';

const themePatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(['UTAMA', 'SELINGAN']).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  active: z.boolean().optional(),
  examples: z.array(z.string().trim().min(1)).min(1).optional()
});
const weightsSchema = z.object({
  weights: z.array(z.object({ id: z.uuid(), weight: z.number().int().min(0).max(100) })).min(1)
}).refine((body) => body.weights.reduce((sum, w) => sum + w.weight, 0) === 100, { message: 'Total bobot tema harus 100' });
const settingsPatchSchema = z.object({
  formatMix: formatMixSchema.optional(),
  dailyPostLimit: z.number().int().min(1).max(20).optional(),
  paused: z.boolean().optional()
});
const textSchema = z.object({ text: z.string().trim().min(1) });
const noteSchema = z.object({ note: z.string().trim().min(1) });
const topicSchema = z.object({ topic: z.string().trim().min(1) });
const topicPatchSchema = z.object({ status: z.enum(['OPEN', 'RESOLVED']) });

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function registerEditorialRoutes(app: FastifyInstance, editorial: EditorialRepository): void {
  app.get('/api/themes', async () => editorial.listThemes());

  app.post('/api/themes', async (request, reply) => {
    const parsed = presetThemeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Data tema tidak valid', detail: parsed.error.issues });
    const themes = await editorial.listThemes();
    if (themes.reduce((sum, t) => sum + t.weight, 0) + parsed.data.weight !== 100) {
      return reply.code(400).send({ error: 'Total bobot tema harus 100; seimbangkan lewat editor bobot' });
    }
    try {
      return reply.code(201).send(await editorial.createTheme(parsed.data));
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send({ error: 'Nama tema sudah dipakai' });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/themes/:id', async (request, reply) => {
    const parsed = themePatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Perubahan tema tidak valid', detail: parsed.error.issues });
    if (parsed.data.weight !== undefined) {
      const themes = await editorial.listThemes();
      const others = themes.filter((t) => t.id !== request.params.id).reduce((sum, t) => sum + t.weight, 0);
      if (others + parsed.data.weight !== 100) return reply.code(400).send({ error: 'Total bobot tema harus 100' });
    }
    try {
      const theme = await editorial.updateTheme(request.params.id, parsed.data);
      return theme ?? reply.code(404).send({ error: 'Tema tidak ditemukan' });
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send({ error: 'Nama tema sudah dipakai' });
      throw error;
    }
  });

  app.put('/api/themes/weights', async (request, reply) => {
    const parsed = weightsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Total bobot tema harus 100 dan semua ID valid' });
    const themes = await editorial.listThemes();
    const ids = new Set(themes.map((t) => t.id));
    const submitted = new Set(parsed.data.weights.map((w) => w.id));
    if (submitted.size !== ids.size || submitted.size !== parsed.data.weights.length || ![...submitted].every((id) => ids.has(id))) {
      return reply.code(400).send({ error: 'Kirim tepat satu bobot untuk setiap tema' });
    }
    const ok = await editorial.updateWeights(parsed.data.weights);
    if (!ok) return reply.code(404).send({ error: 'Tema tidak ditemukan' });
    return editorial.listThemes();
  });

  app.get('/api/settings', async () => editorial.getSettings());

  app.patch('/api/settings', async (request, reply) => {
    const parsed = settingsPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Pengaturan tidak valid; porsi format harus berjumlah 100' });
    const current = await editorial.getSettings();
    const merged = settingsSchema.safeParse({
      formatMix: parsed.data.formatMix ?? current.formatMix,
      dailyPostLimit: parsed.data.dailyPostLimit ?? current.dailyPostLimit,
      paused: parsed.data.paused ?? current.paused
    });
    if (!merged.success) return reply.code(400).send({ error: 'Pengaturan tidak valid' });
    return editorial.updateSettings(merged.data);
  });

  app.get('/api/voice-examples', async () => editorial.listVoiceExamples());
  app.post('/api/voice-examples', async (request, reply) => {
    const parsed = textSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Teks contoh suara wajib diisi' });
    return reply.code(201).send(await editorial.addVoiceExample(parsed.data.text));
  });
  app.delete<{ Params: { id: string } }>('/api/voice-examples/:id', async (request, reply) => {
    const ok = await editorial.deleteVoiceExample(request.params.id);
    return ok ? { ok: true } : reply.code(404).send({ error: 'Contoh suara tidak ditemukan' });
  });

  app.get('/api/personal-sources', async () => editorial.listPersonalSources());
  app.post('/api/personal-sources', async (request, reply) => {
    const parsed = noteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Catatan pengalaman pemilik wajib diisi' });
    return reply.code(201).send(await editorial.addPersonalSource(parsed.data.note));
  });
  app.delete<{ Params: { id: string } }>('/api/personal-sources/:id', async (request, reply) => {
    const ok = await editorial.deletePersonalSource(request.params.id);
    return ok ? { ok: true } : reply.code(404).send({ error: 'Sumber pengalaman tidak ditemukan' });
  });

  app.get('/api/review-topics', async () => editorial.listReviewTopics());
  app.post('/api/review-topics', async (request, reply) => {
    const parsed = topicSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Topik review wajib diisi' });
    return reply.code(201).send(await editorial.addReviewTopic(parsed.data.topic));
  });
  app.patch<{ Params: { id: string } }>('/api/review-topics/:id', async (request, reply) => {
    const parsed = topicPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Status topik harus OPEN atau RESOLVED' });
    const topic = await editorial.updateReviewTopicStatus(request.params.id, parsed.data.status);
    return topic ?? reply.code(404).send({ error: 'Topik review tidak ditemukan' });
  });
}
