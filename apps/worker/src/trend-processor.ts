import { randomUUID } from 'node:crypto';
import { TREND_JOB_NAME } from '@threads-id/contracts';
import type { TrendJobData, TrendItem } from '@threads-id/contracts';
import type { DraftRepository, EditorialRepository, TrendRepository } from '@threads-id/db';
import type { TrendTransport } from './trend-provider.js';
import { discoverFromSource } from './trend-provider.js';
import { scoreTrendItem, type TrendThemeHint } from './trend-scoring.js';

const MAX_ATTEMPTS = 3;

/** Dispatcher: antrekan run QUEUED ke pg-boss tanpa membanjiri job duplikat. */
export async function dispatchTrendRuns(
  repo: TrendRepository,
  boss: { send: (name: string, data: { runId: string; requestedBy?: string | null }, options?: Record<string, unknown>) => Promise<string | null> },
  pool: { query: (text: string, values: unknown[]) => Promise<{ rowCount: number | null }> }
): Promise<void> {
  for (const run of await repo.pendingRuns()) {
    const existing = await pool.query(
      "SELECT 1 FROM pgboss.job WHERE name = $1 AND data->>'runId' = $2 AND state IN ('created','active','retry') LIMIT 1",
      [TREND_JOB_NAME, run.runId]
    );
    if (existing.rowCount) continue;
    await boss.send(TREND_JOB_NAME, { runId: run.runId, requestedBy: run.requestedBy }, {
      singletonKey: run.runId, retryLimit: MAX_ATTEMPTS, retryDelay: 30, retryBackoff: true
    });
  }
}

export type TrendDiscoveryDeps = {
  trends: TrendRepository;
  drafts: DraftRepository;
  editorial: EditorialRepository;
  transport?: TrendTransport | undefined;
};

export type TrendDiscoveryResult = {
  runId: string;
  state: 'OK' | 'DISABLED' | 'PAUSED';
  sources: number;
  items: number;
  newItems: number;
  drafts: number;
  skippedLimit: number;
  skippedNoTheme: number;
  failures: string[];
};

/** Tema dipilih dari kecocokan kata kunci, bukan sembarang tema pertama. */
export function pickTheme(themes: TrendThemeHint[], text: string): string | null {
  if (themes.length === 0) return null;
  const haystack = text.toLowerCase();
  let best: { id: string; hits: number } | null = null;
  for (const theme of themes) {
    const words = theme.name.toLowerCase().split(/\s+/).filter((word) => word.length >= 4);
    const hits = words.filter((word) => haystack.includes(word)).length;
    if (!best || hits > best.hits) best = { id: theme.id, hits };
  }
  return best && best.hits > 0 ? best.id : themes[0]?.id ?? null;
}

/**
 * Satu kali discovery: ambil semua sumber, simpan item (dedupe), skor,
 * lalu ubah yang ≥ ambang menjadi draft TREN_RELEVAN (status IN_REVIEW).
 * Tidak ada pembuatan draft bila nonaktif/dijeda, dan daily_limit selalu ditegakkan.
 */
export async function processTrendDiscovery(data: TrendJobData, deps: TrendDiscoveryDeps): Promise<TrendDiscoveryResult> {
  const settings = await deps.trends.getSettings();
  const empty: TrendDiscoveryResult = {
    runId: data.runId, state: settings.enabled ? 'PAUSED' : 'DISABLED',
    sources: 0, items: 0, newItems: 0, drafts: 0, skippedLimit: 0, skippedNoTheme: 0, failures: []
  };
  if (!settings.enabled || settings.paused) return empty;

  const themes = (await deps.editorial.listThemes()).map<TrendThemeHint>((theme) => ({
    id: theme.id, name: theme.name, examples: theme.examples
  }));
  const result: TrendDiscoveryResult = {
    runId: data.runId, state: 'OK', sources: settings.sources.length,
    items: 0, newItems: 0, drafts: 0, skippedLimit: 0, skippedNoTheme: 0, failures: []
  };

  let remaining = Math.max(0, settings.dailyLimit - (await deps.trends.countCandidatesToday()));

  for (const source of settings.sources) {
    let found: Array<Omit<TrendItem, 'id' | 'fetchedAt' | 'raw'>>;
    try {
      found = await discoverFromSource(source, deps.transport);
    } catch (cause) {
      result.failures.push(`${source.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }
    for (const raw of found) {
      result.items += 1;
      const itemId = randomUUID();
      if (!(await deps.trends.insertItem({ ...raw, id: itemId }))) continue;
      result.newItems += 1;
      if (remaining <= 0) { result.skippedLimit += 1; continue; }

      const score = scoreTrendItem({ ...raw, id: itemId, fetchedAt: new Date().toISOString(), raw: null }, themes);
      if (score.score < settings.threshold) continue;

      const themeId = pickTheme(themes, `${raw.title} ${raw.summary ?? ''}`);
      if (!themeId) { result.skippedNoTheme += 1; continue; }

      const draft = await deps.drafts.create({
        themeId,
        format: 'TREN_RELEVAN',
        text: `[KANDIDAT TREN] ${raw.title}`,
        sourceUrl: raw.url,
        sourceTime: raw.publishedAt,
        relevanceNote: `Skor ${score.score}/100 (ambang ${settings.threshold}). ${score.reasons
          .map((reason) => `${reason.label} ${reason.points}`)
          .join(' · ')}`
      });
      const candidateId = await deps.trends.createCandidate({
        id: randomUUID(), itemId, score: score.score, threshold: settings.threshold, reasons: score.reasons
      });
      if (candidateId) await deps.trends.markConverted(candidateId, draft.id);
      result.drafts += 1;
      remaining -= 1;
    }
  }
  return result;
}
