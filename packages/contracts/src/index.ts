import { z } from 'zod';
export * from './generation.js';
export * from './trend.js';

export const DEMO_JOB_NAME = 'demo.synthetic-age-20s' as const;

// ===== Phase 3: Meta Threads =====
export const THREADS_JOB_NAME = 'threads.publish-text' as const;
export const THREADS_BASE_URL = 'https://graph.threads.com/v1.0' as const;
/** Meta: teks post maksimal 500 karakter; emoji dihitung sebagai byte UTF-8. */
export const THREADS_MAX_TEXT = 500 as const;
/** Meta merekomendasikan menunggu ~30 detik sebelum publish; polling status 1/menit, maksimal 5 menit. */
export const THREADS_PUBLISH_WAIT_MS = 30_000 as const;
export const THREADS_STATUS_POLL_MS = 60_000 as const;
export const THREADS_STATUS_POLL_MAX = 5 as const;
export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'] as const;

export const threadsConnectionStatusSchema = z.enum([
  'DISCONNECTED', 'CONNECTED', 'TOKEN_EXPIRED', 'AUTH_ERROR', 'SCOPE_MISSING', 'RATE_LIMITED', 'NOT_CONFIGURED'
]);
export type ThreadsConnectionStatus = z.infer<typeof threadsConnectionStatusSchema>;

export const threadsPublishTriggerSchema = z.enum(['MANUAL', 'SCHEDULED']);
export type ThreadsPublishTrigger = z.infer<typeof threadsPublishTriggerSchema>;
export const publishStatusSchema = z.enum([
  'QUEUED', 'CONTAINER_CREATED', 'PUBLISHED', 'NEEDS_REVIEW', 'FAILED', 'DUPLICATE', 'REQUIRES_LIVE'
]);
export type PublishStatus = z.infer<typeof publishStatusSchema>;

/** Status eksekusi gabungan: simulasi Phase 1 + hasil posting live Phase 3. */
export const executionStatusSchema = z.enum([
  'SIMULATED_OK', 'PUBLISHED', 'SKIPPED_STALE', 'SKIPPED_CANCELLED', 'SKIPPED_PAUSED', 'SKIPPED_LIMIT',
  'CANCELLED', 'FAILED', 'NEEDS_REVIEW', 'DUPLICATE', 'REQUIRES_LIVE'
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export const PUBLISHED_EXECUTION_STATUSES = ['PUBLISHED', 'NEEDS_REVIEW', 'DUPLICATE', 'REQUIRES_LIVE'] as const;
export type PublishedExecutionStatus = typeof PUBLISHED_EXECUTION_STATUSES[number];

export const editorialSampleSchema = z.object({
  pillar: z.literal('KEBIASAAN_DIGITAL'),
  format: z.literal('OBSERVASI_PENDEK'),
  text: z.string().min(1)
});
export type EditorialSample = z.infer<typeof editorialSampleSchema>;
export const DEMO_EDITORIAL_SAMPLE: EditorialSample = {
  pillar: 'KEBIASAAN_DIGITAL',
  format: 'OBSERVASI_PENDEK',
  text: 'Niat buka HP buat cek jam. Lima menit kemudian udah baca debat cara nyimpen telur. Jamnya masih belum tahu.'
};
export const demoJobDataSchema = z.object({ actionId: z.uuid(), sample: editorialSampleSchema });
export type DemoJobData = z.infer<typeof demoJobDataSchema>;
export const demoResultSchema = z.object({
  message: z.string(),
  editorialSample: editorialSampleSchema.optional(),
  simulatedAgeSeconds: z.number().int().nonnegative().optional()
});
export type DemoResult = z.infer<typeof demoResultSchema>;
export const actionStatusSchema = z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const actionSchema = z.object({
  id: z.uuid(),
  kind: z.literal('SYNTHETIC_AGE_20S'),
  status: actionStatusSchema,
  demo: z.literal(true),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  result: demoResultSchema.nullable().optional(),
  error: z.string().nullable().optional()
});
export type DemoAction = z.infer<typeof actionSchema>;

export const createActionResponseSchema = z.object({ actionId: z.uuid(), status: z.literal('QUEUED'), demo: z.literal(true) });
export type CreateActionResponse = z.infer<typeof createActionResponseSchema>;

export const actionListSchema = z.array(actionSchema);

// ===== Phase 1: editorial =====
export const themeRoleSchema = z.enum(['UTAMA', 'SELINGAN']);
export type ThemeRole = z.infer<typeof themeRoleSchema>;
export const contentFormatSchema = z.enum(['OBSERVASI_PENDEK', 'BAHASAN_LEBIH_DALAM', 'TREN_RELEVAN']);
export type ContentFormat = z.infer<typeof contentFormatSchema>;

export const presetThemeSchema = z.object({
  name: z.string().min(1),
  role: themeRoleSchema,
  weight: z.number().int().min(0).max(100),
  examples: z.array(z.string().min(1)).min(1)
});
export type PresetTheme = z.infer<typeof presetThemeSchema>;

export const PRESET_THEMES: PresetTheme[] = [
  {
    name: 'Pertemanan dan chat', role: 'UTAMA', weight: 30,
    examples: ['Ada teman yang gak pernah chat duluan, tapi kalau diajak makan malah dia yang paling niat cari tempat.']
  },
  {
    name: 'Kerja dan kuliah', role: 'UTAMA', weight: 30,
    examples: ['Yang bikin capek dari hari Senin kadang udah dimulai Minggu malam, pas buka kalender.']
  },
  {
    name: 'Kebiasaan digital', role: 'UTAMA', weight: 30,
    examples: ['Niat buka HP buat cek jam. Lima menit kemudian udah baca debat cara nyimpen telur. Jamnya masih belum tahu.']
  },
  {
    name: 'Uang dan jajan', role: 'SELINGAN', weight: 10,
    examples: ['Ongkir 15 ribu bikin batal checkout. Nambah menu 25 ribu demi gratis ongkir masih bisa dipertimbangkan.']
  }
];

export const formatMixSchema = z.object({
  OBSERVASI_PENDEK: z.number().int().min(0).max(100),
  BAHASAN_LEBIH_DALAM: z.number().int().min(0).max(100),
  TREN_RELEVAN: z.number().int().min(0).max(100)
}).refine((mix) => mix.OBSERVASI_PENDEK + mix.BAHASAN_LEBIH_DALAM + mix.TREN_RELEVAN === 100, {
  message: 'Porsi format harus berjumlah 100'
});
export type FormatMix = z.infer<typeof formatMixSchema>;
export const DEFAULT_FORMAT_MIX: FormatMix = { OBSERVASI_PENDEK: 70, BAHASAN_LEBIH_DALAM: 20, TREN_RELEVAN: 10 };

export const settingsSchema = z.object({
  formatMix: formatMixSchema,
  dailyPostLimit: z.number().int().min(1).max(20),
  paused: z.boolean()
});
export type EditorialSettings = z.infer<typeof settingsSchema>;

export const draftStatusSchema = z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'CANCELLED']);
export type DraftStatus = z.infer<typeof draftStatusSchema>;
export const scheduleStatusSchema = z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']);
export type ScheduleStatus = z.infer<typeof scheduleStatusSchema>;
/** Didefinisikan di blok Phase 3 di atas; duplikat di sini dihapus. */

export const SCHEDULE_JOB_NAME_V1 = 'schedule.simulate-publication' as const;
export const SCHEDULE_JOB_NAME = SCHEDULE_JOB_NAME_V1;
export const scheduleJobDataSchema = z.object({ scheduleId: z.uuid(), version: z.number().int().positive() });
export type ScheduleJobData = z.infer<typeof scheduleJobDataSchema>;

export const draftSourcesSchema = z.object({
  format: contentFormatSchema,
  sourceUrl: z.string().nullable(),
  sourceTime: z.string().nullable(),
  relevanceNote: z.string().nullable()
});
export type DraftSources = z.infer<typeof draftSourcesSchema>;

/** Draft tren wajib punya URL sumber, waktu sumber, dan kaitan jelas dengan audiens; format reguler tidak wajib. */
export function trendSourcesComplete(draft: DraftSources): boolean {
  if (draft.format !== 'TREN_RELEVAN') return true;
  return Boolean(draft.sourceUrl && draft.sourceUrl.trim() && draft.sourceTime && draft.relevanceNote && draft.relevanceNote.trim());
}

export const loginRequestSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Hari kalender Asia/Jakarta (UTC+7, tanpa DST) untuk timestamp UTC. */
export function jakartaDay(instant: string | Date): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export const integrationItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  connected: z.boolean(),
  mode: z.enum(['SIMULASI', 'BELUM_TERHUBUNG', 'LIVE_TEREKONKSI', 'BELUM_LIVE']),
  note: z.string().min(1)
});
export const integrationStatusSchema = z.object({
  mode: z.enum(['SIMULASI', 'SIAP_LIVE']),
  livePosting: z.boolean(),
  integrations: z.array(integrationItemSchema)
}).superRefine((value, ctx) => {
  // Jujur: livePosting hanya boleh true bila Meta tampil terhubung.
  const meta = value.integrations.find((item) => item.id === 'meta-threads');
  if (value.livePosting && (!meta || !meta.connected)) {
    ctx.addIssue({ code: 'custom', message: 'livePosting true but Meta Threads not connected' });
  }
  if (meta?.connected && !value.livePosting) {
    ctx.addIssue({ code: 'custom', message: 'Meta connected but live posting is off' });
  }
});
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

/** Status integrasi Phase 1 yang jujur: tidak ada koneksi Meta/Gemini dan tidak ada posting live. */
export const PHASE1_INTEGRATION_STATUS: IntegrationStatus = {
  mode: 'SIMULASI',
  livePosting: false,
  integrations: [
    {
      id: 'meta-threads', name: 'Meta Threads (publikasi)', connected: false, mode: 'SIMULASI',
      note: 'Belum terhubung. OAuth Meta dan posting live adalah cakupan Phase 3. Semua eksekusi jadwal saat ini adalah simulasi lokal dengan ID semu berprefiks sim-, bukan post nyata.'
    },
    {
      id: 'gemini', name: 'Gemini (pembuatan konten)', connected: false, mode: 'BELUM_TERHUBUNG',
      note: 'Belum terhubung. Integrasi Gemini Developer API adalah cakupan Phase 2. Phase 1 tidak memanggil API eksternal apa pun; draft dibuat manual oleh admin.'
    }
  ]
};
