import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type pg from 'pg';
import { createPool } from './index.js';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Terapkan semua migrasi .sql berurutan (idempoten) memakai satu pool. */
export async function applyMigrations(pool: pg.Pool): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(resolve(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }
}

export async function migrate(): Promise<void> {
  const pool = createPool();
  try {
    await applyMigrations(pool);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  console.log('Migrasi database selesai.');
}
