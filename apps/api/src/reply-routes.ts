import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ReplyRepository } from '@threads-id/db';
import { replySettingsSchema } from '@threads-id/contracts';

/** Phase 4B: antrean balasan Threads dengan live & pause terpisah dari post. */
export async function registerReplyRoutes(app: FastifyInstance, replies: ReplyRepository): Promise<void> {
  app.get('/api/threads/replies/settings', async () => replies.getSettings());

  app.patch('/api/threads/replies/settings', async (request, reply) => {
    const parsed = replySettingsSchema.pick({ livePosting: true, paused: true, dailyLimit: true }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Pengaturan balasan tidak valid', detail: parsed.error.issues });
    return replies.updateSettings(parsed.data);
  });

  app.get('/api/threads/replies', async () => replies.list(50));

  app.post('/api/threads/replies', async (request, reply) => {
    const body = request.body as { replyToId?: string; text?: string };
    const replyToId = body.replyToId?.trim() ?? '';
    const text = body.text?.trim() ?? '';
    if (!replyToId || !text) return reply.code(400).send({ error: 'replyToId dan text wajib diisi.' });
    if (Buffer.byteLength(text, 'utf8') > 500) return reply.code(400).send({ error: 'Teks balasan maksimal 500 byte UTF-8.' });

    const settings = await replies.getSettings();
    const queued = await replies.enqueue({ id: randomUUID(), replyToId, text, requestedBy: request.session?.username ?? null });
    if (!queued) return reply.code(409).send({ error: 'Balasan identik untuk media ini sudah pernah dipesan.' });
    return reply.code(settings.livePosting ? 202 : 200).send({ reply: queued, liveEnabled: settings.livePosting });
  });

  app.get<{ Params: { id: string } }>('/api/threads/replies/:id', async (request, reply) => {
    const row = await replies.get(request.params.id);
    if (!row) return reply.code(404).send({ error: 'Antrean balasan tidak ditemukan.' });
    return row;
  });

  app.post<{ Params: { id: string } }>('/api/threads/replies/:id/resolve', async (request, reply) => {
    const body = request.body as { resolution?: string };
    if (body.resolution !== 'REPLIED' && body.resolution !== 'FAILED') {
      return reply.code(400).send({ error: 'Resolusi harus REPLIED atau FAILED.' });
    }
    const row = await replies.get(request.params.id);
    if (!row) return reply.code(404).send({ error: 'Antrean balasan tidak ditemukan.' });
    if (row.status !== 'NEEDS_REVIEW') return reply.code(409).send({ error: 'Hanya antrean NEEDS_REVIEW yang bisa direkonsiliasi.' });
    await replies.resolve(row.id, body.resolution);
    return replies.get(row.id);
  });
}
