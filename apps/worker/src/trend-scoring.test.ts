import { describe, expect, it } from 'vitest';
import type { TrendItem } from '@threads-id/contracts';
import { scoreTrendItem } from './trend-scoring.js';

const themes = [
  { id: 't1', name: 'Kebiasaan digital', examples: ['scroll', 'notifikasi'] },
  { id: 't2', name: 'Kerja dan kuliah', examples: ['gaji', 'deadline'] }
];

function item(overrides: Partial<TrendItem> = {}): TrendItem {
  return {
    id: 'i', source: 'detik', sourceName: 'detiknews', title: 'Judul', url: 'https://x.test/a',
    summary: null, publishedAt: new Date().toISOString(), categories: [], raw: null,
    fetchedAt: new Date().toISOString(), ...overrides
  };
}

describe('skor relevansi tren (audit, bukan angka hitam)', () => {
  it('memberi poin untuk tema, audiens, kebaruan, sumber, kategori', () => {
    const score = scoreTrendItem(item({
      title: 'Scroll medsos sampai lupa deadline kuliah',
      summary: 'Kebiasaan digital anak kos',
      categories: ['teknologi']
    }), themes);
    expect(score.score).toBeGreaterThanOrEqual(60);
    expect(score.reasons.length).toBeGreaterThan(3);
    expect(score.reasons.every((reason) => Number.isFinite(reason.points))).toBe(true);
  });

  it('item lama dan tanpa kaitan tetap rendah', () => {
    const score = scoreTrendItem(item({
      title: 'Saham naik tipis',
      summary: 'Pergerakan indeks',
      publishedAt: new Date(Date.now() - 10 * 24 * 3600_000).toISOString(),
      categories: []
    }), themes);
    expect(score.score).toBeLessThan(40);
  });

  it('total tidak pernah di luar 0–100', () => {
    for (const title of ['', 'ai', 'scroll chat kuliah gaji teknologi']) {
      const score = scoreTrendItem(item({ title }), themes);
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
    }
  });
});
