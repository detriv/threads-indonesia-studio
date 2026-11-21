import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { AuthRepository, hashPassword, hashSessionToken } from './auth.js';
import { resetTestDatabase, truncateAll } from './testing.js';

let pool: pg.Pool;
let auth: AuthRepository;

beforeAll(async () => {
  pool = await resetTestDatabase();
  auth = new AuthRepository(pool);
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => { await truncateAll(pool); });

describe('auth repository (PostgreSQL)', () => {
  it('bootstrap membuat tepat satu admin dan menolak hash non-Argon2id', async () => {
    const hash = await hashPassword('password-lokal-yang-kuat');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await auth.ensureAdmin('admin', hash);
    await auth.ensureAdmin('admin-kedua', hash); // tidak boleh menambah admin kedua
    expect(await auth.countAdmins()).toBe(1);
    expect((await auth.findAdmin('admin'))?.username).toBe('admin');
    expect(await auth.findAdmin('admin-kedua')).toBeNull();
    await expect(auth.ensureAdmin('admin', 'plaintext-bukan-hash')).rejects.toThrow();
  });

  it('verifikasi kredensial benar/salah tanpa membocorkan hash', async () => {
    await auth.ensureAdmin('admin', await hashPassword('password-lokal-yang-kuat'));
    expect(await auth.verifyCredentials('admin', 'password-lokal-yang-kuat')).toBe(true);
    expect(await auth.verifyCredentials('admin', 'salah')).toBe(false);
    expect(await auth.verifyCredentials('tidak-ada', 'password-lokal-yang-kuat')).toBe(false);
  });

  it('session disimpan sebagai hash opaque, bisa diambil, dihapus, dan kedaluwarsa', async () => {
    const token = 'token-acak-rahasia';
    const tokenHash = hashSessionToken(token);
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const expires = new Date(Date.now() + 60_000);
    await auth.createSession(tokenHash, 'csrf-1', expires, 'admin');
    const session = await auth.findSession(tokenHash);
    expect(session?.csrfToken).toBe('csrf-1');
    expect(session?.username).toBe('admin');
    expect(session?.expiresAt.toISOString()).toBe(expires.toISOString());
    expect(await auth.findSession(hashSessionToken('token-lain'))).toBeNull();
    await auth.deleteSession(tokenHash);
    expect(await auth.findSession(tokenHash)).toBeNull();
    await auth.createSession(tokenHash, 'csrf-2', new Date(Date.now() - 1000), 'admin');
    expect(await auth.findSession(tokenHash)).toBeNull(); // kedaluwarsa tidak berlaku
    expect(await auth.purgeExpiredSessions()).toBeGreaterThanOrEqual(1);
  });
});
