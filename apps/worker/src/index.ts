import { dispatchGenerationRequests } from './generation-dispatcher.js';
import { processGeneration } from './generation-processor.js';
import { generateForProvider } from './generation-provider.js';
import { GENERATION_JOB_NAME } from '@threads-id/contracts';
import { GenerationRepository } from '@threads-id/db';
import { PgBoss } from 'pg-boss';
import { DEMO_JOB_NAME, demoJobDataSchema, SCHEDULE_JOB_NAME, scheduleJobDataSchema } from '@threads-id/contracts';
import { ActionRepository, ScheduleRepository, createPool } from '@threads-id/db';
import { processDemoAction } from './processor.js';
import { createSimulationAdapter, processScheduleJob } from './schedule-processor.js';
import { dispatchOutbox } from './dispatcher.js';

if (process.env.DEMO_MODE !== 'true') throw new Error('Phase 1 hanya boleh berjalan dengan DEMO_MODE=true (simulasi, tanpa publikasi live)');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL wajib diisi');
const pool = createPool(connectionString);
const repo = new ActionRepository(pool);
const scheduleRepo = new ScheduleRepository(pool);
const generationRepo = new GenerationRepository(pool);
const adapter = createSimulationAdapter();
const boss = new PgBoss({ connectionString });
await boss.start();
await boss.createQueue(DEMO_JOB_NAME);
await boss.createQueue(GENERATION_JOB_NAME,{policy:'exclusive'});
await boss.work<{requestId:string}>(GENERATION_JOB_NAME,{batchSize:1},async jobs=>{
 for(const job of jobs)await processGeneration(job.data.requestId,generationRepo,(input,context,model,provider)=>generateForProvider(input,context,model,provider,{allowed:process.env.GEMINI_ALLOW_OUTBOUND==='true',key:process.env.GEMINI_API_KEY}));
});
async function dispatchGenerations(){await dispatchGenerationRequests(generationRepo,boss);}
await boss.createQueue(SCHEDULE_JOB_NAME);

await boss.work(DEMO_JOB_NAME, async (jobs) => {
  for (const job of jobs) await processDemoAction(demoJobDataSchema.parse(job.data), repo);
});

await boss.work(SCHEDULE_JOB_NAME, { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) {
    const outcome = await processScheduleJob(scheduleJobDataSchema.parse(job.data), scheduleRepo, adapter);
    // Pause global: lempar error agar pg-boss meretry dengan backoff; tidak ada eksekusi tercatat.
    if (outcome === 'DEFERRED_PAUSED') throw new Error('Jadwal dipause global; menunda eksekusi');
  }
});

// Dispatcher outbox berjalan berkala untuk merekonsiliasi jadwal tersimpan dengan antrean job.
let dispatching = false;
const dispatchTimer = setInterval(() => {
  if (dispatching) return;
  dispatching = true;
  void Promise.all([dispatchOutbox(pool, boss),dispatchGenerations()])
    .catch((error) => console.error('Dispatcher outbox gagal:', error instanceof Error ? error.message : error))
    .finally(() => { dispatching = false; });
}, 1000);
dispatchTimer.unref();
await dispatchOutbox(pool, boss);
await dispatchGenerations();

console.log('Worker DEMO + jadwal simulasi siap.');
await import('node:fs/promises').then(({ writeFile }) => writeFile('/tmp/worker-ready', 'ready\n'));

const close = async () => { clearInterval(dispatchTimer); await boss.stop(); await pool.end(); };
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
