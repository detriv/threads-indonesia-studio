import { PgBoss } from 'pg-boss';
import { DEMO_JOB_NAME } from '@threads-id/contracts';
import { ActionRepository, createPool } from '@threads-id/db';
import { migrate } from '@threads-id/db/migrate';
import { buildApp } from './app.js';

if (process.env.DEMO_MODE !== 'true') throw new Error('Phase 0 hanya boleh berjalan dengan DEMO_MODE=true');
await migrate();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL wajib diisi');
const pool = createPool(connectionString);
const boss = new PgBoss({ connectionString });
await boss.start();
await boss.createQueue(DEMO_JOB_NAME);
const app = buildApp({ repo: new ActionRepository(pool), queue: boss });

const close = async () => { await app.close(); await boss.stop(); await pool.end(); };
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
await app.listen({ host: '0.0.0.0', port: Number(process.env.API_PORT ?? 3000) });
