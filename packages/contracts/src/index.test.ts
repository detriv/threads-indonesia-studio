import { describe, expect, it } from 'vitest';
import {
  actionSchema, actionStatusSchema, DEFAULT_FORMAT_MIX, DEMO_EDITORIAL_SAMPLE, DEMO_JOB_NAME,
  demoJobDataSchema, draftStatusSchema, executionStatusSchema, formatMixSchema, PRESET_THEMES,
  SCHEDULE_JOB_NAME, scheduleJobDataSchema, scheduleStatusSchema, settingsSchema, trendSourcesComplete, jakartaDay,
  integrationStatusSchema
} from './index.js';

describe('contracts', () => {
  it('accepts a traceable demo action and rejects non-demo data', () => {
    expect(actionSchema.parse({ id: crypto.randomUUID(), kind: 'SYNTHETIC_AGE_20S', status: 'QUEUED', demo: true })).toMatchObject({ demo: true });
    expect(() => actionSchema.parse({ id: crypto.randomUUID(), kind: 'REAL_META_ACTION', status: 'QUEUED', demo: false })).toThrow();
    expect(actionStatusSchema.options).toEqual(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
    expect(DEMO_JOB_NAME).toBe('demo.synthetic-age-20s');
    expect(DEMO_EDITORIAL_SAMPLE).toMatchObject({
      pillar: 'KEBIASAAN_DIGITAL',
      format: 'OBSERVASI_PENDEK'
    });
    expect(DEMO_EDITORIAL_SAMPLE.text).toContain('cek jam');
    expect(demoJobDataSchema.parse({ actionId: crypto.randomUUID(), sample: DEMO_EDITORIAL_SAMPLE })).toMatchObject({
      sample: DEMO_EDITORIAL_SAMPLE
    });
  });
});

describe('kontrak editorial Phase 1', () => {
  it('preset memuat tepat tiga tema utama dan satu selingan dengan teks contoh asli', () => {
    expect(PRESET_THEMES).toHaveLength(4);
    expect(PRESET_THEMES.filter((t) => t.role === 'UTAMA').map((t) => t.name)).toEqual([
      'Pertemanan dan chat', 'Kerja dan kuliah', 'Kebiasaan digital'
    ]);
    const selingan = PRESET_THEMES.filter((t) => t.role === 'SELINGAN');
    expect(selingan).toHaveLength(1);
    expect(selingan[0]?.name).toBe('Uang dan jajan');
    expect(PRESET_THEMES.find((t) => t.name === 'Pertemanan dan chat')?.examples[0]).toContain('gak pernah chat duluan');
    expect(PRESET_THEMES.find((t) => t.name === 'Kerja dan kuliah')?.examples[0]).toContain('Minggu malam');
    expect(PRESET_THEMES.find((t) => t.name === 'Kebiasaan digital')?.examples[0]).toContain('cara nyimpen telur');
    expect(PRESET_THEMES.find((t) => t.name === 'Uang dan jajan')?.examples[0]).toContain('Ongkir 15 ribu');
    expect(PRESET_THEMES.reduce((sum, t) => sum + t.weight, 0)).toBe(100);
  });

  it('porsi format default 70/20/10 dan wajib berjumlah 100', () => {
    expect(DEFAULT_FORMAT_MIX).toEqual({ OBSERVASI_PENDEK: 70, BAHASAN_LEBIH_DALAM: 20, TREN_RELEVAN: 10 });
    expect(formatMixSchema.parse(DEFAULT_FORMAT_MIX)).toEqual(DEFAULT_FORMAT_MIX);
    expect(() => formatMixSchema.parse({ OBSERVASI_PENDEK: 70, BAHASAN_LEBIH_DALAM: 20, TREN_RELEVAN: 20 })).toThrow();
    expect(() => formatMixSchema.parse({ OBSERVASI_PENDEK: -5, BAHASAN_LEBIH_DALAM: 95, TREN_RELEVAN: 10 })).toThrow();
    expect(settingsSchema.parse({ formatMix: DEFAULT_FORMAT_MIX, dailyPostLimit: 2, paused: false })).toMatchObject({ dailyPostLimit: 2 });
    expect(() => settingsSchema.parse({ formatMix: DEFAULT_FORMAT_MIX, dailyPostLimit: 0, paused: false })).toThrow();
  });

  it('memisahkan siklus draft, status jadwal, dan status eksekusi', () => {
    expect(draftStatusSchema.options).toEqual(['DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'CANCELLED']);
    expect(scheduleStatusSchema.options).toEqual(['SCHEDULED', 'COMPLETED', 'CANCELLED']);
    // Phase 3 menambahkan PUBLISHED/NEEDS_REVIEW/DUPLICATE/REQUIRES_LIVE tanpa menghapus status Phase 1.
    expect(executionStatusSchema.options).toContain('SIMULATED_OK');
    expect(executionStatusSchema.options).toContain('PUBLISHED');
    expect(SCHEDULE_JOB_NAME).toBe('schedule.simulate-publication');
    expect(scheduleJobDataSchema.parse({ scheduleId: crypto.randomUUID(), version: 2 })).toMatchObject({ version: 2 });
    expect(() => scheduleJobDataSchema.parse({ scheduleId: crypto.randomUUID(), version: 0 })).toThrow();
  });

  it('draft tren hanya dianggap bersumber memadai bila ada URL, waktu, dan kaitan audiens', () => {
    const base = { format: 'TREN_RELEVAN' as const, sourceUrl: 'https://example.com/tren', sourceTime: '2026-11-20T03:00:00.000Z', relevanceNote: 'Sering dialami anak kos usia 20-an' };
    expect(trendSourcesComplete(base)).toBe(true);
    expect(trendSourcesComplete({ ...base, sourceUrl: null })).toBe(false);
    expect(trendSourcesComplete({ ...base, sourceTime: null })).toBe(false);
    expect(trendSourcesComplete({ ...base, relevanceNote: '  ' })).toBe(false);
    expect(trendSourcesComplete({ format: 'OBSERVASI_PENDEK', sourceUrl: null, sourceTime: null, relevanceNote: null })).toBe(true);
  });

  it('jakartaDay menghitung hari Asia/Jakarta (UTC+7) dari timestamp UTC', () => {
    expect(jakartaDay('2026-11-20T16:59:59.000Z')).toBe('2026-11-20'); // 23:59 WIB
    expect(jakartaDay('2026-11-20T17:00:00.000Z')).toBe('2026-11-21'); // 00:00 WIB
    expect(jakartaDay(new Date('2026-11-21T00:30:00.000Z'))).toBe('2026-11-21');
  });

  it('status integrasi jujur: live mati default, publikasi Meta terpisah dari Gemini', () => {
    // Phase 3: livePosting false + mode SIMULASI tetap valid; status koneksi Meta kini bisa jujur.
    const honest = {
      mode: 'SIMULASI' as const, livePosting: false,
      integrations: [
        { id: 'meta-threads', name: 'Meta Threads', connected: false, mode: 'BELUM_LIVE' as const, note: 'Fase 3' },
        { id: 'gemini', name: 'Gemini', connected: false, mode: 'BELUM_TERHUBUNG' as const, note: 'Fase 2' }
      ]
    };
    expect(integrationStatusSchema.parse(honest)).toMatchObject({ mode: 'SIMULASI', livePosting: false });
    expect(() => integrationStatusSchema.parse({ ...honest, livePosting: true })).toThrow();
    expect(() => integrationStatusSchema.parse({ ...honest, integrations: [{ ...honest.integrations[0], connected: true }] })).toThrow();
    const live = {
      mode: 'SIAP_LIVE' as const, livePosting: true,
      integrations: [
        { id: 'meta-threads', name: 'Meta Threads', connected: true, mode: 'LIVE_TEREKONKSI' as const, note: 'Aktif' },
        { id: 'gemini', name: 'Gemini', connected: false, mode: 'BELUM_TERHUBUNG' as const, note: 'Fase 2' }
      ]
    };
    expect(integrationStatusSchema.parse(live)).toMatchObject({ mode: 'SIAP_LIVE', livePosting: true });
    // Konsistensi: livePosting=true wajib Meta connected=true.
    expect(() => integrationStatusSchema.parse({ ...live, integrations: [{ ...live.integrations[0], connected: false }, live.integrations[1]] })).toThrow();
    // Mode lama 'SIMULASI' untuk Meta masih valid selama live mati.
    expect(integrationStatusSchema.parse({ ...honest, integrations: [{ ...honest.integrations[0], mode: 'SIMULASI' as const }, honest.integrations[1]] })).toMatchObject({ livePosting: false });
  });
});
