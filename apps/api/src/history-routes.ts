import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generationConfig, threadsEnv } from '@threads-id/db';
import type { ScheduleRepository, ThreadsRepository } from '@threads-id/db';
import { contentFormatSchema, executionStatusSchema, PHASE1_INTEGRATION_STATUS } from '@threads-id/contracts';

const historyQuerySchema = z.object({
  status: executionStatusSchema.optional(),
  themeId: z.uuid().optional(),
  format: contentFormatSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

export function registerHistoryRoutes(app: FastifyInstance, schedule: ScheduleRepository, deps: { threads?: ThreadsRepository | undefined } = {}): void {
  app.get('/api/history', async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filter riwayat tidak valid' });
    return schedule.listExecutions(parsed.data);
  });

  app.get('/api/integrations', async () => {
    const threads = await (deps.threads?.getConnection() ?? null);
    const env = threadsEnv();
    const liveEnabled = Boolean(threads?.livePosting ?? env.livePosting);
    // Jujur: "terhubung/live siap" hanya bila live aktif DAN kredensial + token tersedia.
    const credentialsReady = Boolean(
      (threads?.appId ?? env.appId) && (threads?.accessTokenPresent ?? Boolean(env.accessToken)) && (threads?.userId ?? env.userId)
    );
    const livePosting = liveEnabled && credentialsReady;
    const metaItem = {
      id: 'meta-threads',
      name: 'Meta Threads (publikasi)',
      connected: livePosting,
      mode: livePosting ? 'LIVE_TEREKONKSI' : 'BELUM_LIVE',
      note: liveEnabled
        ? (credentialsReady
          ? 'Publikasi live diaktifkan operator dengan kredensial terpasang. Posting masih memerlukan token berlaku dan kuota Meta; hasil posting live tetap direview sebelum eksekusi.'
          : 'Live diaktifkan, tapi kredensial/token Meta belum lengkap. Antrean akan gagal CONFIG sampai THREADS_APP_ID/SECRET/USER_ID/ACCESS_TOKEN diisi.')
        : 'Belum terhubung. OAuth Meta dan publikasi live adalah cakupan Fase 3. Selama live nonaktif, eksekusi jadwal adalah simulasi lokal dengan ID semu berprefiks sim-, bukan post nyata.'
    };
    const geminiItem = {
      ...PHASE1_INTEGRATION_STATUS.integrations[1]!,
      mode: generationConfig('SHORT').provider === 'SIMULATION' ? 'SIMULASI' : 'BELUM_TERHUBUNG',
      note: `Provider generasi: ${generationConfig('SHORT').provider}. Konfigurasi bukan bukti koneksi live terverifikasi. Konten Gemini pada halaman Draft menampilkan request/model/pemakaian/gagal dan cadangan; publikasi Meta terpisah di koneksi Meta Threads.`
    };
    return {
      mode: livePosting ? 'SIAP_LIVE' : 'SIMULASI',
      livePosting,
      integrations: [metaItem, geminiItem]
    };
  });
}
