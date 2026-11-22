import { dispatchGenerationRequests } from './generation-dispatcher.js';
import { processGeneration } from './generation-processor.js';
import { generateForProvider } from './generation-provider.js';
import { GENERATION_JOB_NAME } from '@threads-id/contracts';
import { GenerationRepository } from '@threads-id/db';
import { PgBoss } from 'pg-boss';
import { readFileSync } from 'node:fs';
import { DEMO_JOB_NAME, demoJobDataSchema, SCHEDULE_JOB_NAME, scheduleJobDataSchema, THREADS_JOB_NAME, THREADS_REPLY_JOB_NAME, TREND_JOB_NAME, trendJobDataSchema, replyJobDataSchema, REPLY_INBOX_JOB_NAME, replyInboxRunSchema } from '@threads-id/contracts';
import { ActionRepository, DraftRepository, EditorialRepository, ReplyRepository, ScheduleRepository, ThreadsRepository, TrendRepository, createPool } from '@threads-id/db';
import { processDemoAction } from './processor.js';
import { createSimulationAdapter, processScheduleJob, type ThreadsPublishAdapter } from './schedule-processor.js';
import { dispatchOutbox } from './dispatcher.js';
import { dispatchThreadsPublish, processThreadsPublish } from './threads-processor.js';
import { dispatchThreadsReplies, processThreadsReply } from './reply-processor.js';
import { dispatchReplyInbox, processReplyInbox } from './reply-inbox.js';
import { processTrendDiscovery, dispatchTrendRuns } from './trend-processor.js';
import { generationConfig } from '@threads-id/db';

if (process.env.DEMO_MODE !== 'true') throw new Error('Phase 1 hanya boleh berjalan dengan DEMO_MODE=true (simulasi, tanpa publikasi live)');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL wajib diisi');
const pool = createPool(connectionString);
const repo = new ActionRepository(pool);
const scheduleRepo = new ScheduleRepository(pool);
const generationRepo = new GenerationRepository(pool);
const threadsRepo = new ThreadsRepository(pool);
const trendRepo = new TrendRepository(pool);
const replyRepo = new ReplyRepository(pool);
const editorial = new EditorialRepository(pool);
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
  await boss.createQueue(TREND_JOB_NAME);
  await boss.createQueue(THREADS_REPLY_JOB_NAME);
  await boss.createQueue(REPLY_INBOX_JOB_NAME);
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

/** Simpan token hasil refresh ke file yang sama (0600). Nilai token tidak pernah ke DB. */
async function persistWorkerToken(token: string): Promise<void> {
  const { writeFile, chmod } = await import('node:fs/promises');
  const path = process.env.THREADS_TOKEN_FILE ?? '/tmp/threads-token/token';
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
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
      persistToken: persistWorkerToken,
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

await boss.work(REPLY_INBOX_JOB_NAME, { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) {
    const { runId } = replyInboxRunSchema.parse(job.data);
    try {
      const result = await processReplyInbox({ runId }, {
        replies: replyRepo, threads: threadsRepo, editorial, token: workerAccessToken,
        // Auto-draft AI (opsional): hanya jalan bila Gemini outbound diizinkan operator.
        draft: async ({ username, text }) => {
          if (process.env.GEMINI_ALLOW_OUTBOUND !== 'true' || !process.env.GEMINI_API_KEY) return null;
          try {
            const themes = await editorial.listThemes();
            const theme = themes[0];
            if (!theme) return null;
            const model = generationConfig('SHORT').model;
            const generated = await generateForProvider(
              {
                purpose: 'SHORT', themeId: theme.id, format: 'OBSERVASI_PENDEK',
                instruction: `Balas komentar @${username ?? 'pengguna'}: "${text}". Balas singkat, santai, dan tetap pada topik.`,
                evidence: null, personalSourceId: null, draftId: null, expectedVersion: null
              },
              { theme: { name: theme.name, examples: theme.examples }, voices: [], ownerNote: null, original: { text, format: 'OBSERVASI_PENDEK' } },
              model, 'GEMINI', { allowed: true, key: process.env.GEMINI_API_KEY }
            );
            return generated.output.drafts[0]?.text ?? null;
          } catch {
            return null; // gagal draft tidak menghalangi operator menulis manual
          }
        }
      });
      await replyRepo.completeInboxRun(runId, result);
    } catch (cause) {
      await replyRepo.failInboxRun(runId, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }
});

await boss.work(THREADS_REPLY_JOB_NAME, { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) {
    const { queueId } = replyJobDataSchema.parse(job.data);
    await processThreadsReply(queueId, {
      replies: replyRepo, threads: threadsRepo,
      live: async () => (await replyRepo.getSettings()).livePosting,
      token: workerAccessToken,
      persistToken: persistWorkerToken
    });
  }
});

await boss.work(TREND_JOB_NAME, { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) {
    const data = trendJobDataSchema.parse(job.data);
    try {
      const result = await processTrendDiscovery(data, { trends: trendRepo, drafts, editorial });
      await trendRepo.completeRun(data.runId, result);
    } catch (cause) {
      await trendRepo.failRun(data.runId, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
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
  void Promise.all([dispatchOutbox(pool, boss),dispatchGenerations(),dispatchThreadsPublish(threadsRepo,boss,pool),dispatchTrendRuns(trendRepo,boss,pool),dispatchThreadsReplies(replyRepo,boss,pool),dispatchReplyInbox(replyRepo,boss,pool)])
    .catch((error) => console.error('Dispatcher outbox gagal:', error instanceof Error ? error.message : error))
    .finally(() => { dispatching = false; });
}, 1000);
dispatchTimer.unref();
// Dispatcher berkala sudah menutupi kegagalan transient; percobaan awal tidak boleh membunuh worker.
await withRetry('dispatcher awal', async () => {
  await dispatchOutbox(pool, boss);
  await dispatchGenerations();
  await dispatchThreadsPublish(threadsRepo, boss, pool);
  await dispatchTrendRuns(trendRepo, boss, pool);
  await dispatchThreadsReplies(replyRepo, boss, pool);
  await dispatchReplyInbox(replyRepo, boss, pool);
}, 5, 1000);

console.log('Worker DEMO + jadwal simulasi + Threads publish siap.');
await import('node:fs/promises').then(({ writeFile }) => writeFile('/tmp/worker-ready', 'ready\n'));

const close = async () => { clearInterval(dispatchTimer); await boss.stop(); await pool.end(); };
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
