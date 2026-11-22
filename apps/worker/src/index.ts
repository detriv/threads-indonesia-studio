import { dispatchGenerationRequests } from './generation-dispatcher.js';
import { processGeneration } from './generation-processor.js';
import { generateForProvider } from './generation-provider.js';
import { GENERATION_JOB_NAME } from '@threads-id/contracts';
import { GenerationRepository } from '@threads-id/db';
import { PgBoss } from 'pg-boss';
import { readFileSync } from 'node:fs';
import { DEMO_JOB_NAME, demoJobDataSchema, SCHEDULE_JOB_NAME, scheduleJobDataSchema, THREADS_JOB_NAME } from '@threads-id/contracts';
import { ActionRepository, DraftRepository, ScheduleRepository, ThreadsRepository, createPool } from '@threads-id/db';
import { processDemoAction } from './processor.js';
import { createSimulationAdapter, processScheduleJob, type ThreadsPublishAdapter } from './schedule-processor.js';
import { dispatchOutbox } from './dispatcher.js';
import { dispatchThreadsPublish, processThreadsPublish } from './threads-processor.js';

if (process.env.DEMO_MODE !== 'true') throw new Error('Phase 1 hanya boleh berjalan dengan DEMO_MODE=true (simulasi, tanpa publikasi live)');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL wajib diisi');
const pool = createPool(connectionString);
const repo = new ActionRepository(pool);
const scheduleRepo = new ScheduleRepository(pool);
const generationRepo = new GenerationRepository(pool);
const threadsRepo = new ThreadsRepository(pool);
const drafts = new DraftRepository(pool);
const adapter = createSimulationAdapter();
const boss = new PgBoss({ connectionString });

/** Restart/rollout bisa mulai sebelum PostgreSQL siap menerima koneksi.
 * Coba lagi dengan backoff; kegagalan transient tidak boleh membunuh worker. */
async function withRetry<T>(label: string, operation: () => Promise<T>, attempts = 15, delayMs = 2000): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      console.warn(`${label} gagal (percobaan ${attempt}/${attempts}): ${error instanceof Error ? error.message : error}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw last;
}

await withRetry('pg-boss start', () => boss.start());
await withRetry('createQueue', async () => {
  await boss.createQueue(DEMO_JOB_NAME);
  await boss.createQueue(GENERATION_JOB_NAME, { policy: 'exclusive' });
  await boss.createQueue(SCHEDULE_JOB_NAME);
  await boss.createQueue(THREADS_JOB_NAME);
});
await boss.work<{requestId:string}>(GENERATION_JOB_NAME,{batchSize:1},async jobs=>{
 for(const job of jobs)await processGeneration(job.data.requestId,generationRepo,(input,context,model,provider)=>generateForProvider(input,context,model,provider,{allowed:process.env.GEMINI_ALLOW_OUTBOUND==='true',key:process.env.GEMINI_API_KEY}));
});
async function dispatchGenerations(){await dispatchGenerationRequests(generationRepo,boss);}

/** Token Meta dibaca dari file yang ditulis API saat OAuth (chmod 600), bukan dari DB. */
function workerAccessToken(): string | undefined {
  if (process.env.THREADS_ACCESS_TOKEN?.trim()) return process.env.THREADS_ACCESS_TOKEN.trim();
  const file = process.env.THREADS_TOKEN_FILE ?? '/tmp/threads-token/token';
  try {
    return readFileSync(file, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

const threadsAdapter: ThreadsPublishAdapter = {
  async enqueueFromSchedule({ draftId, scheduleId }) {
    const live = threadsLive();
    return threadsRepo.enqueue({ draftId, scheduleId, trigger: 'SCHEDULED', requestedBy: 'scheduler', liveEnabled: live });
  }
};

function threadsLive(): boolean {
  const envLive = process.env.THREADS_LIVE_POSTING === 'true';
  const connection = (process.env.THREADS_CONNECTION_LIVE ?? '') === 'true';
  return envLive || connection;
}

await boss.work(THREADS_JOB_NAME, { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) {
    const { queueId } = job.data as { queueId: string };
    const outcome = await processThreadsPublish(queueId, {
      threads: threadsRepo,
      token: workerAccessToken,
      draftText: async (draftId) => {
        const draft = await drafts.get(draftId);
        return draft ? { id: draft.id, text: draft.text } : null;
      },
      onAmbiguous: () => {
        // Biarkan job gagal → pg-boss retry dengan backoff; status tetap NEEDS_REVIEW.
        throw new Error('Publikasi ambigu; menunggu rekonsiliasi operator');
      }
    });
    if (outcome?.status === 'NEEDS_REVIEW') throw new Error('Publikasi ambigu; menunggu rekonsiliasi operator');
  }
});

await boss.work(DEMO_JOB_NAME, async (jobs) => {
  for (const job of jobs) await processDemoAction(demoJobDataSchema.parse(job.data), repo);
});

await boss.work(SCHEDULE_JOB_NAME, { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) {
    const outcome = await processScheduleJob(scheduleJobDataSchema.parse(job.data), scheduleRepo, adapter, {
      threads: threadsAdapter,
      livePosting: threadsLive()
    });
    // Pause global: lempar error agar pg-boss meretry dengan backoff; tidak ada eksekusi tercatat.
    if (outcome === 'DEFERRED_PAUSED') throw new Error('Jadwal dipause global; menunda eksekusi');
  }
});

// Dispatcher outbox berjalan berkala untuk merekonsiliasi jadwal tersimpan dengan antrean job.
let dispatching = false;
const dispatchTimer = setInterval(() => {
  if (dispatching) return;
  dispatching = true;
  void Promise.all([dispatchOutbox(pool, boss),dispatchGenerations(),dispatchThreadsPublish(threadsRepo,boss)])
    .catch((error) => console.error('Dispatcher outbox gagal:', error instanceof Error ? error.message : error))
    .finally(() => { dispatching = false; });
}, 1000);
dispatchTimer.unref();
// Dispatcher berkala sudah menutupi kegagalan transient; percobaan awal tidak boleh membunuh worker.
await withRetry('dispatcher awal', async () => {
  await dispatchOutbox(pool, boss);
  await dispatchGenerations();
  await dispatchThreadsPublish(threadsRepo, boss);
}, 5, 1000);

console.log('Worker DEMO + jadwal simulasi + Threads publish siap.');
await import('node:fs/promises').then(({ writeFile }) => writeFile('/tmp/worker-ready', 'ready\n'));

const close = async () => { clearInterval(dispatchTimer); await boss.stop(); await pool.end(); };
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
