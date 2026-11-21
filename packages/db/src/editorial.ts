import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DEFAULT_FORMAT_MIX, PRESET_THEMES } from '@threads-id/contracts';
import type { EditorialSettings, ThemeRole } from '@threads-id/contracts';

export type Theme = {
  id: string; name: string; role: ThemeRole; weight: number; active: boolean;
  examples: string[]; createdAt: string; updatedAt: string;
};
export type VoiceExample = { id: string; text: string; createdAt: string };
export type PersonalSource = { id: string; note: string; createdAt: string };
export type ReviewTopic = { id: string; topic: string; status: 'OPEN' | 'RESOLVED'; createdAt: string; updatedAt: string };
export type ThemeInput = { name: string; role: ThemeRole; weight: number; examples: string[] };
export type ThemePatch = { name?: string | undefined; role?: ThemeRole | undefined; weight?: number | undefined; active?: boolean | undefined; examples?: string[] | undefined };

type ThemeRow = { id: string; name: string; role: ThemeRole; weight: number; active: boolean; created_at: Date; updated_at: Date };
type ExampleRow = { theme_id: string; text: string; position: number };
type SettingsRow = { format_mix: EditorialSettings['formatMix']; daily_post_limit: number; paused: boolean };

export class EditorialRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** Preset empat tema + pengaturan default; hanya mengisi bila masih kosong. */
  async seedDefaults(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const count = await client.query<{ n: string }>('SELECT count(*)::int AS n FROM themes');
      if (Number(count.rows[0]?.n ?? 0) === 0) {
        for (const [sortOrder, preset] of PRESET_THEMES.entries()) {
          const id = randomUUID();
          await client.query('INSERT INTO themes (id, name, role, weight, sort_order) VALUES ($1, $2, $3, $4, $5)', [id, preset.name, preset.role, preset.weight, sortOrder]);
          for (const [position, text] of preset.examples.entries()) {
            await client.query('INSERT INTO theme_examples (id, theme_id, text, position) VALUES ($1, $2, $3, $4)', [randomUUID(), id, text, position]);
          }
        }
      }
      await client.query(
        'INSERT INTO editorial_settings (id, format_mix, daily_post_limit, paused) VALUES (1, $1::jsonb, $2, false) ON CONFLICT (id) DO NOTHING',
        [JSON.stringify(DEFAULT_FORMAT_MIX), 2]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async withExamples(rows: ThemeRow[]): Promise<Theme[]> {
    if (rows.length === 0) return [];
    const examples = await this.pool.query<ExampleRow>('SELECT theme_id, text, position FROM theme_examples ORDER BY position');
    return rows.map((row) => ({
      id: row.id, name: row.name, role: row.role, weight: row.weight, active: row.active,
      examples: examples.rows.filter((e) => e.theme_id === row.id).map((e) => e.text),
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
    }));
  }

  async listThemes(): Promise<Theme[]> {
    const result = await this.pool.query<ThemeRow>('SELECT * FROM themes ORDER BY sort_order, created_at, name');
    return this.withExamples(result.rows);
  }

  async getTheme(id: string): Promise<Theme | null> {
    const result = await this.pool.query<ThemeRow>('SELECT * FROM themes WHERE id = $1', [id]);
    const themes = await this.withExamples(result.rows);
    return themes[0] ?? null;
  }

  async createTheme(input: ThemeInput): Promise<Theme> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const nextOrder = await client.query<{ n: number }>('SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM themes');
      await client.query('INSERT INTO themes (id, name, role, weight, sort_order) VALUES ($1, $2, $3, $4, $5)', [id, input.name, input.role, input.weight, nextOrder.rows[0]?.n ?? 0]);
      for (const [position, text] of input.examples.entries()) {
        await client.query('INSERT INTO theme_examples (id, theme_id, text, position) VALUES ($1, $2, $3, $4)', [randomUUID(), id, text, position]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const theme = await this.getTheme(id);
    if (!theme) throw new Error('Tema gagal dibuat');
    return theme;
  }

  async updateTheme(id: string, patch: ThemePatch): Promise<Theme | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const sets: string[] = [];
      const values: unknown[] = [];
      const push = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
      if (patch.name !== undefined) push('name', patch.name);
      if (patch.role !== undefined) push('role', patch.role);
      if (patch.weight !== undefined) push('weight', patch.weight);
      if (patch.active !== undefined) push('active', patch.active);
      if (sets.length > 0) {
        values.push(id);
        const result = await client.query(`UPDATE themes SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
        if (result.rowCount === 0) { await client.query('ROLLBACK'); return null; }
      }
      if (patch.examples !== undefined) {
        await client.query('DELETE FROM theme_examples WHERE theme_id = $1', [id]);
        for (const [position, text] of patch.examples.entries()) {
          await client.query('INSERT INTO theme_examples (id, theme_id, text, position) VALUES ($1, $2, $3, $4)', [randomUUID(), id, text, position]);
        }
        await client.query('UPDATE themes SET updated_at = now() WHERE id = $1', [id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getTheme(id);
  }

  async updateWeights(weights: Array<{ id: string; weight: number }>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const entry of weights) {
        const result = await client.query('UPDATE themes SET weight = $2, updated_at = now() WHERE id = $1', [entry.id, entry.weight]);
        if (result.rowCount === 0) { await client.query('ROLLBACK'); return false; }
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getSettings(): Promise<EditorialSettings> {
    const result = await this.pool.query<SettingsRow>('SELECT format_mix, daily_post_limit, paused FROM editorial_settings WHERE id = 1');
    const row = result.rows[0];
    if (!row) throw new Error('Pengaturan editorial belum di-seed');
    return { formatMix: row.format_mix, dailyPostLimit: row.daily_post_limit, paused: row.paused };
  }

  async updateSettings(settings: EditorialSettings): Promise<EditorialSettings> {
    await this.pool.query('UPDATE editorial_settings SET format_mix = $1::jsonb, daily_post_limit = $2, paused = $3, updated_at = now() WHERE id = 1', [JSON.stringify(settings.formatMix), settings.dailyPostLimit, settings.paused]);
    return this.getSettings();
  }

  async listVoiceExamples(): Promise<VoiceExample[]> {
    const result = await this.pool.query<{ id: string; text: string; created_at: Date }>('SELECT * FROM voice_examples ORDER BY created_at');
    return result.rows.map((r) => ({ id: r.id, text: r.text, createdAt: r.created_at.toISOString() }));
  }
  async addVoiceExample(text: string): Promise<VoiceExample> {
    const id = randomUUID();
    const result = await this.pool.query<{ created_at: Date }>('INSERT INTO voice_examples (id, text) VALUES ($1, $2) RETURNING created_at', [id, text]);
    return { id, text, createdAt: result.rows[0]!.created_at.toISOString() };
  }
  async deleteVoiceExample(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM voice_examples WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listPersonalSources(): Promise<PersonalSource[]> {
    const result = await this.pool.query<{ id: string; note: string; created_at: Date }>('SELECT * FROM personal_sources ORDER BY created_at');
    return result.rows.map((r) => ({ id: r.id, note: r.note, createdAt: r.created_at.toISOString() }));
  }
  async addPersonalSource(note: string): Promise<PersonalSource> {
    const id = randomUUID();
    const result = await this.pool.query<{ created_at: Date }>('INSERT INTO personal_sources (id, note) VALUES ($1, $2) RETURNING created_at', [id, note]);
    return { id, note, createdAt: result.rows[0]!.created_at.toISOString() };
  }
  async deletePersonalSource(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM personal_sources WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listReviewTopics(): Promise<ReviewTopic[]> {
    const result = await this.pool.query<{ id: string; topic: string; status: 'OPEN' | 'RESOLVED'; created_at: Date; updated_at: Date }>('SELECT * FROM review_topics ORDER BY created_at');
    return result.rows.map((r) => ({ id: r.id, topic: r.topic, status: r.status, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() }));
  }
  async addReviewTopic(topic: string): Promise<ReviewTopic> {
    const id = randomUUID();
    const result = await this.pool.query<{ created_at: Date; updated_at: Date }>('INSERT INTO review_topics (id, topic) VALUES ($1, $2) RETURNING created_at, updated_at', [id, topic]);
    const row = result.rows[0]!;
    return { id, topic, status: 'OPEN', createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }
  async updateReviewTopicStatus(id: string, status: 'OPEN' | 'RESOLVED'): Promise<ReviewTopic | null> {
    const result = await this.pool.query<{ id: string; topic: string; status: 'OPEN' | 'RESOLVED'; created_at: Date; updated_at: Date }>(
      'UPDATE review_topics SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, status]
    );
    const r = result.rows[0];
    return r ? { id: r.id, topic: r.topic, status: r.status, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() } : null;
  }
}
