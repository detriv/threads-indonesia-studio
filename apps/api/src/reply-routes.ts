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

  // --- Kotak masuk balasan (4C) ---
  app.get('/api/threads/inbox', async () => replies.listInbox(50));

  app.post('/api/threads/inbox/refresh', async (request, reply) => {
    const runId = randomUUID();
    await replies.createInboxRun(runId);
    return reply.code(202).send({ runId, status: 'QUEUED' });
  });

  app.get<{ Params: { id: string } }>('/api/threads/inbox/runs/:id', async (request, reply) => {
    const run = await replies.getInboxRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'Run inbox tidak ditemukan.' });
    return run;
  });

  app.post<{ Params: { id: string } }>('/api/threads/inbox/:id/approve', async (request, reply) => {
    const items = await replies.listInbox(500);
    const item = items.find((row) => row.id === request.params.id);
    if (!item) return reply.code(404).send({ error: 'Balasan masuk tidak ditemukan.' });
    if (item.status !== 'PENDING') return reply.code(409).send({ error: 'Hanya balasan PENDING yang bisa disetujui.' });
    const body = (request.body ?? {}) as { text?: string };
    const text = (body.text ?? item.draftText ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'Teks balasan kosong; isi manual atau tunggu auto-draft.' });
    if (Buffer.byteLength(text, 'utf8') > 500) return reply.code(400).send({ error: 'Teks balasan maksimal 500 byte UTF-8.' });
    const settings = await replies.getSettings();
    const queued = await replies.enqueue({ id: randomUUID(), replyToId: item.replyMediaId, text, requestedBy: request.session?.username ?? null });
    if (!queued) return reply.code(409).send({ error: 'Balasan identik untuk media ini sudah pernah dipesan.' });
    await replies.markInboxApproved(item.id);
    return reply.code(settings.livePosting ? 202 : 200).send({ reply: queued, liveEnabled: settings.livePosting });
  });

  app.post<{ Params: { id: string } }>('/api/threads/inbox/:id/dismiss', async (request, reply) => {
    const items = await replies.listInbox(500);
    const item = items.find((row) => row.id === request.params.id);
    if (!item) return reply.code(404).send({ error: 'Balasan masuk tidak ditemukan.' });
    await replies.dismissInbox(item.id);
    return { ok: true, id: item.id };
  });
}
