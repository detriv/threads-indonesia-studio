import { createHash } from 'node:crypto';
import { Algorithm, hash, hashSync, verify } from '@node-rs/argon2';
import type pg from 'pg';

/** Hash password admin dengan Argon2id (default @node-rs/argon2: memory 19 MiB, time 2, parallelism 1). */
export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: Algorithm.Argon2id });
}

/** Hash opaque token session: hanya hash ini yang disimpan di PostgreSQL. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Hash dummy asli (bukan rahasia) untuk menyamakan waktu verifikasi saat username tidak dikenal.
const DUMMY_HASH = hashSync('dummy-password-bukan-rahasia', { algorithm: Algorithm.Argon2id });

type AdminRow = { username: string; password_hash: string };
type SessionRow = { username: string; csrf_token: string; expires_at: Date };

export class AuthRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** Bootstrap satu admin dari env. Tidak pernah menimpa admin yang sudah ada; menolak hash non-Argon2id. */
  async ensureAdmin(username: string, passwordHash: string): Promise<void> {
    if (!username.trim()) throw new Error('ADMIN_USERNAME wajib diisi');
    if (!passwordHash.startsWith('$argon2id$')) throw new Error('ADMIN_PASSWORD_HASH harus hash Argon2id (gunakan npm run hash-password)');
    const existing = await this.pool.query('SELECT username FROM admin_users WHERE id = 1');
    if (existing.rowCount && existing.rowCount > 0) return;
    await this.pool.query('INSERT INTO admin_users (id, username, password_hash) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING', [username, passwordHash]);
  }

  async countAdmins(): Promise<number> {
    const result = await this.pool.query<{ n: string }>('SELECT count(*)::int AS n FROM admin_users');
    return Number(result.rows[0]?.n ?? 0);
  }

  async findAdmin(username: string): Promise<{ username: string; passwordHash: string } | null> {
    const result = await this.pool.query<AdminRow>('SELECT username, password_hash FROM admin_users WHERE username = $1', [username]);
    const row = result.rows[0];
    return row ? { username: row.username, passwordHash: row.password_hash } : null;
  }

  async verifyCredentials(username: string, password: string): Promise<boolean> {
    const admin = await this.findAdmin(username);
    if (!admin) {
      // Verifikasi dummy agar waktu respons tidak membocorkan keberadaan username.
      await verify(DUMMY_HASH, password).catch(() => false);
      return false;
    }
    return verify(admin.passwordHash, password);
  }

  async createSession(tokenHash: string, csrfToken: string, expiresAt: Date, username: string): Promise<void> {
    await this.pool.query('INSERT INTO admin_sessions (token_hash, username, csrf_token, expires_at) VALUES ($1, $2, $3, $4)', [tokenHash, username, csrfToken, expiresAt]);
  }

  async findSession(tokenHash: string): Promise<{ csrfToken: string; expiresAt: Date; username: string } | null> {
    const result = await this.pool.query<SessionRow>('SELECT username, csrf_token, expires_at FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()', [tokenHash]);
    const row = result.rows[0];
    return row ? { csrfToken: row.csrf_token, expiresAt: row.expires_at, username: row.username } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
  }

  async purgeExpiredSessions(): Promise<number> {
    const result = await this.pool.query('DELETE FROM admin_sessions WHERE expires_at <= now()');
    return result.rowCount ?? 0;
  }
}
