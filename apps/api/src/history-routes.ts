import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generationConfig } from '@threads-id/db';
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

  app.get('/api/integrations', async () => ({...PHASE1_INTEGRATION_STATUS,integrations:PHASE1_INTEGRATION_STATUS.integrations.map(item=>item.id!=='gemini'?item:{...item,mode:generationConfig('SHORT').provider==='SIMULATION'?'SIMULASI':'BELUM_TERHUBUNG',note:`Provider generasi: ${generationConfig('SHORT').provider}. Konfigurasi bukan bukti koneksi live terverifikasi. Konten Gemini pada halaman Draft menampilkan request/model/pemakaian/gagal dan cadangan; publikasi Meta tetap nonaktif.`})}));
}
