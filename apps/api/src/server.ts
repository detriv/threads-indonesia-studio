import { PgBoss } from 'pg-boss';
import { DEMO_JOB_NAME } from '@threads-id/contracts';
import { GenerationRepository, ActionRepository, AuthRepository, DraftRepository, EditorialRepository, ScheduleRepository, createPool } from '@threads-id/db';
import { migrate } from '@threads-id/db/migrate';
import { buildApp } from './app.js';

if (process.env.DEMO_MODE !== 'true') throw new Error('Phase 1 hanya boleh berjalan dengan DEMO_MODE=true (simulasi, tanpa publikasi live)');
await migrate();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL wajib diisi');
const pool = createPool(connectionString);
const auth = new AuthRepository(pool);

// Bootstrap satu admin hanya dari env eksplisit; tidak ada password default.
if ((await auth.countAdmins()) === 0) {
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!username || !passwordHash) {
    throw new Error('Admin belum ada. Isi ADMIN_USERNAME dan ADMIN_PASSWORD_HASH (Argon2id, buat dengan: npm run hash-password). Tidak ada password default.');
  }
  await auth.ensureAdmin(username, passwordHash);
  console.log(`Admin bootstrap selesai untuk username "${username}" (hash tidak dicatat).`);
}

const editorial = new EditorialRepository(pool);
await editorial.seedDefaults();

const boss = new PgBoss({ connectionString });
await boss.start();
await boss.createQueue(DEMO_JOB_NAME);
const app = buildApp({
  repo: new ActionRepository(pool),
  queue: boss,
  auth,
  editorial,
  drafts: new DraftRepository(pool),
  generation: new GenerationRepository(pool),
  schedule: new ScheduleRepository(pool),
  sessionTtlMs: Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600_000,
  cookieSecure: process.env.COOKIE_SECURE === 'true'
});

const purgeTimer = setInterval(() => { void auth.purgeExpiredSessions(); }, 3600_000);
purgeTimer.unref();

const close = async () => { await app.close(); await boss.stop(); await pool.end(); };
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
await app.listen({ host: '0.0.0.0', port: Number(process.env.API_PORT ?? 3000) });
