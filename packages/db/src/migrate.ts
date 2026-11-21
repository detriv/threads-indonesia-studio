import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createPool } from './index.js';

export async function migrate(): Promise<void> {
  const pool = createPool();
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const sql = await readFile(resolve(here, '../migrations/001_init.sql'), 'utf8');
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  console.log('Migrasi database selesai.');
}
