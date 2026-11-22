import { randomUUID } from 'node:crypto';
import type { ExecutionStatus, ScheduleJobData } from '@threads-id/contracts';
import type { PublishQueueRow, ScheduleRepository } from '@threads-id/db';

/**
 * Adapter simulasi Phase 1: TIDAK ada panggilan ke Meta/Gemini.
 * Hasil selalu ditandai simulated=true dengan ID eksternal semu berprefiks sim-.
 */
export type SimulationAdapter = {
  simulatePublication(draft: { id: string; text: string; format: string; themeName: string }): Promise<Record<string, unknown>>;
};

/**
 * Adapter publikasi Phase 3: saat live posting aktif, eksekusi jadwal masuk antrean publish
 * Meta Threads (bukan simulasi). Hasil akhir tetap dicatat di schedule_executions dengan
 * status PUBLISHED/NEEDS_REVIEW/DUPLICATE/REQUIRES_LIVE.
 */
export type ThreadsPublishAdapter = {
  enqueueFromSchedule(input: { draftId: string; scheduleId: string; text: string }): Promise<PublishQueueRow>;
};

export function createSimulationAdapter(): SimulationAdapter {
  return {
    async simulatePublication(draft) {
      return {
        simulated: true,
        demo: true,
        externalId: `sim-${randomUUID()}`,
        publishedUrl: null,
        draftId: draft.id,
        themeName: draft.themeName,
        format: draft.format,
        text: draft.text,
        publishedAt: new Date().toISOString(),
        message: `Simulasi publikasi teks untuk tema "${draft.themeName}". Tidak ada koneksi ke Meta Threads; tidak ada post nyata yang diterbitkan.`
      };
    }
  };
}

export type ProcessOutcome = ExecutionStatus | 'DEFERRED_PAUSED' | 'DUPLICATE' | 'MISSING' | 'SKIPPED_STALE' | 'SKIPPED_CANCELLED' | 'SKIPPED_LIMIT' | 'QUEUED';

/**
 * Proses job jadwal dengan pengaman berlapis:
 * versi jadwal harus cocok, status harus SCHEDULED, draft tidak batal,
 * tidak pause global, dan batas harian Jakarta belum tercapai.
 * Klaim penyelesaian atomik (UPDATE bersyarat) membuat duplikat/konkuren aman.
 * Bila publikasi live aktif, draft masuk antrean publish Meta; bukan simulasi.
 */
export async function processScheduleJob(
  job: ScheduleJobData,
  repo: ScheduleRepository,
  adapter: SimulationAdapter,
  options: { threads?: ThreadsPublishAdapter | undefined; livePosting?: boolean | undefined } = {}
): Promise<ProcessOutcome> {
  const view = await repo.getForWorker(job.scheduleId);
  if (!view) return 'MISSING';
  if (view.entry.version !== job.version) {
    await repo.recordSkip(job.scheduleId, job.version, 'SKIPPED_STALE');
    return 'SKIPPED_STALE';
  }
  if (view.entry.status === 'CANCELLED' || view.draft.status === 'CANCELLED') {
    await repo.recordSkip(job.scheduleId, job.version, 'SKIPPED_CANCELLED');
    return 'SKIPPED_CANCELLED';
  }
  if (view.entry.status === 'COMPLETED') return 'DUPLICATE';
  if (view.settings.paused || view.draft.status === 'IN_REVIEW' || (view.draft.format === 'TREN_RELEVAN' && !['APPROVED', 'SCHEDULED'].includes(view.draft.status))) return 'DEFERRED_PAUSED';
  const usedToday = await repo.countSimulatedOkForDay(new Date(view.entry.scheduledAt));
  if (usedToday >= view.settings.dailyPostLimit) {
    await repo.recordSkip(job.scheduleId, job.version, 'SKIPPED_LIMIT');
    return 'SKIPPED_LIMIT';
  }
  if (options.livePosting && options.threads) {
    const queued = await options.threads.enqueueFromSchedule({
      draftId: view.draft.id, scheduleId: job.scheduleId, text: view.draft.text
    });
    // Catat pemicu antrean; status akhir (PUBLISHED/NEEDS_REVIEW/...) dikerjakan worker publish.
    await repo.recordPublishedQueue(job.scheduleId, job.version, queued);
    return 'QUEUED';
  }
  const result = await adapter.simulatePublication(view.draft);
  return repo.completeSimulation(job.scheduleId, job.version, result);
}
