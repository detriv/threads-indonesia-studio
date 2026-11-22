import { z } from 'zod';

export const TREND_JOB_NAME = 'trend.discover' as const;

export const trendSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  homepage: z.string().url().optional()
});
export type TrendSource = z.infer<typeof trendSourceSchema>;

/** Sumber RSS/Atom bawaan (gratis, tanpa kunci). Operator bisa menambah/mengurangi.
 * URL diverifikasi HTTP 200; daftar ini bisa berubah bila penerbit mengubah alamat. */
export const DEFAULT_TREND_SOURCES: readonly TrendSource[] = [
  { id: 'detik', name: 'detiknews', url: 'https://news.detik.com/rss' },
  { id: 'kompas', name: 'Kompas', url: 'https://rss.kompas.com/' },
  { id: 'cnnindonesia', name: 'CNN Indonesia', url: 'https://www.cnnindonesia.com/rss' },
  { id: 'antaranews', name: 'Antara News', url: 'https://www.antaranews.com/rss' },
  { id: 'republika', name: 'Republika', url: 'https://www.republika.co.id/rss' }
] as const;

export const trendItemSchema = z.object({
  id: z.string(),
  source: z.string().min(1),
  sourceName: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  summary: z.string().nullable(),
  publishedAt: z.string().nullable(),
  categories: z.array(z.string()),
  raw: z.unknown().nullable(),
  fetchedAt: z.string()
});
export type TrendItem = z.infer<typeof trendItemSchema>;

/** Satu sinyal skor beserta poinnya, supaya skor bisa diaudit. */
export const trendScoreReasonSchema = z.object({
  label: z.string().min(1),
  points: z.number().int().min(-100).max(100),
  detail: z.string().optional()
});
export type TrendScoreReason = z.infer<typeof trendScoreReasonSchema>;

export const trendScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasons: z.array(trendScoreReasonSchema)
});
export type TrendScore = z.infer<typeof trendScoreSchema>;

export const trendCandidateSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  draftId: z.string().nullable(),
  score: z.number().int(),
  threshold: z.number().int(),
  reasons: z.array(trendScoreReasonSchema),
  status: z.enum(['PENDING', 'CONVERTED', 'DISMISSED']),
  title: z.string(),
  url: z.string(),
  sourceName: z.string(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TrendCandidate = z.infer<typeof trendCandidateSchema>;

export const trendSettingsSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  threshold: z.number().int().min(0).max(100),
  dailyLimit: z.number().int().min(1).max(100),
  sources: z.array(trendSourceSchema)
});
export type TrendSettings = z.infer<typeof trendSettingsSchema>;

export const DEFAULT_TREND_SETTINGS: TrendSettings = {
  enabled: true,
  paused: false,
  threshold: 60,
  dailyLimit: 20,
  sources: DEFAULT_TREND_SOURCES.map((source) => ({ ...source }))
};

export const trendJobDataSchema = z.object({
  runId: z.uuid(),
  requestedBy: z.string().max(80).nullable().optional()
});
export type TrendJobData = z.infer<typeof trendJobDataSchema>;
