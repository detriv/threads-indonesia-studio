import { PgBoss } from 'pg-boss';
import { DEMO_JOB_NAME } from '@threads-id/contracts';
import { ActionRepository, createPool } from '@threads-id/db';
import { processDemoAction } from './processor.js';

if (process.env.DEMO_MODE !== 'true') throw new Error('Phase 0 hanya boleh berjalan dengan DEMO_MODE=true');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL wajib diisi');
const pool = createPool(connectionString);
const repo = new ActionRepository(pool);
const boss = new PgBoss({ connectionString });
await boss.start();
await boss.createQueue(DEMO_JOB_NAME);
await boss.work<{ actionId: string }>(DEMO_JOB_NAME, async (jobs) => {
  for (const job of jobs) await processDemoAction(job.data.actionId, repo);
});
console.log('Worker DEMO siap.');
await import('node:fs/promises').then(({ writeFile }) => writeFile('/tmp/worker-ready', 'ready\n'));

const close = async () => { await boss.stop(); await pool.end(); };
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
