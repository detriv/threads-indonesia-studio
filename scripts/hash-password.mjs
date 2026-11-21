import { Algorithm, hash } from '@node-rs/argon2';
import { open, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { URL } from 'node:url';

if (!process.stdin.isTTY) throw new Error('Jalankan di terminal interaktif agar password tidak terlihat.');
const envPath = new URL('../.env', import.meta.url);
const env = await readFile(envPath, 'utf8');
if (env.split(/\r?\n/).some((line) => /^ADMIN_(?:USERNAME|PASSWORD_HASH)=[ \t]*[^\s#]/.test(line))) {
  throw new Error('Konfigurasi admin sudah diisi; tidak akan ditimpa.');
}
let muted = false;
const output = new Writable({ write(chunk, encoding, done) {
  if (muted) done(); else process.stdout.write(chunk, encoding, done);
} });
const prompt = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
prompt.on('SIGINT', () => { prompt.close(); process.exitCode = 130; });
try {
  const username = (await prompt.question('Username admin: ')).trim();
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) throw new Error('Username hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung.');
  const secret = async (label) => {
    process.stdout.write(label);
    muted = true;
    try { return await prompt.question(''); }
    finally { muted = false; process.stdout.write('\n'); }
  };
  const password = await secret('Password admin (minimal 12 karakter): ');
  if (password.length < 12 || password.length > 256) throw new Error('Password harus 12–256 karakter.');
  if ((await secret('Ulangi password: ')) !== password) throw new Error('Password tidak cocok.');
  const passwordHash = await hash(password, { algorithm: Algorithm.Argon2id });
  const file = await open(envPath, 'r+');
  try {
    const current = await file.readFile('utf8');
    if (current !== env) throw new Error('.env berubah saat setup; jalankan lagi.');
    await file.chmod(0o600);
    const updated = env.replace(/^ADMIN_(?:USERNAME|PASSWORD_HASH)=.*\r?\n?/gm, '');
    // Compose mempertahankan tanda $ (hash PHC) dalam nilai single-quoted.
    await writeFile(envPath, `${updated.trimEnd()}\nADMIN_USERNAME=${username}\nADMIN_PASSWORD_HASH='${passwordHash}'\n`, { mode: 0o600 });
  } finally { await file.close(); }
  console.log('Konfigurasi bootstrap admin disimpan di .env.');
} finally { prompt.close(); }
