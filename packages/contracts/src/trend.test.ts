import { describe, expect, it } from 'vitest';
import { DEFAULT_TREND_SETTINGS, DEFAULT_TREND_SOURCES, trendSettingsSchema } from './trend.js';

describe('kontrak tren (Fase 4A)', () => {
  it('sumber bawaan gratis & tanpa kunci', () => {
    expect(DEFAULT_TREND_SOURCES.length).toBeGreaterThan(0);
    for (const source of DEFAULT_TREND_SOURCES) expect(source.url.startsWith('https://')).toBe(true);
  });

  it('pengaturan bawaan: discovery aktif, live tidak relevan, ambang wajar', () => {
    expect(DEFAULT_TREND_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_TREND_SETTINGS.paused).toBe(false);
    expect(DEFAULT_TREND_SETTINGS.threshold).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_TREND_SETTINGS.threshold).toBeLessThanOrEqual(100);
  });

  it('skema menolak ambang di luar 0–100', () => {
    const base = { enabled: true, paused: false, threshold: 101, dailyLimit: 20, sources: [] };
    expect(trendSettingsSchema.safeParse(base).success).toBe(false);
    expect(trendSettingsSchema.safeParse({ ...base, threshold: 60 }).success).toBe(true);
  });
});
