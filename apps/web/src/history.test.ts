import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HistoryView } from './App.js';

type Props = ComponentProps<typeof HistoryView>;
const props: Props = {
  items: [], themes: [], filters: { status: '', themeId: '', format: '', from: '', to: '' },
  loading: false, onFilterChange() {}, onSubmit() {}, onReset() {}
};

describe('history snapshot UI', () => {
  it('labels unavailable legacy metadata instead of presenting current data as historical', () => {
    const item = {
      id: 'execution', scheduleId: 'schedule', draftId: null, draftText: null, themeId: null,
      themeName: null, format: null, draftStatus: null, scheduledAt: null,
      executedAt: '2026-11-21T01:00:00Z', status: 'SKIPPED_STALE', version: 1,
      result: null, error: null, demo: true, snapshotProvenance: 'LEGACY_PARTIAL'
    } satisfies Props['items'][number];
    const html = renderToStaticMarkup(createElement(HistoryView, { ...props, items: [item] }));
    expect(html).toContain('Metadata historis tidak lengkap');
    expect(html).toContain('Tema tidak diketahui');
    expect(html).toContain('Format tidak diketahui');
    expect(html).toContain('Teks historis tidak tersedia');
  });

  it('renders captured theme and text even when the theme has since been renamed', () => {
    const item: Props['items'][number] = {
      id: 'execution', scheduleId: 'schedule', draftId: 'draft', draftText: 'Teks saat eksekusi', themeId: 'theme',
      themeName: 'Tema saat eksekusi', format: 'OBSERVASI_PENDEK', draftStatus: 'SCHEDULED',
      scheduledAt: '2026-11-22T02:00:00Z', executedAt: '2026-11-22T02:00:01Z',
      status: 'SIMULATED_OK', version: 1, result: null, error: null, demo: true, snapshotProvenance: 'CAPTURED'
    };
    const html = renderToStaticMarkup(createElement(HistoryView, { ...props, items: [item], themes: [{ id: 'theme', name: 'Nama tema sekarang', role: 'UTAMA', weight: 100, active: true, examples: [], createdAt: '', updatedAt: '' }] }));
    expect(html).toContain('Teks saat eksekusi');
    expect(html).toContain('Tema saat eksekusi');
    expect(html).toContain('Snapshot eksekusi');
  });
});
