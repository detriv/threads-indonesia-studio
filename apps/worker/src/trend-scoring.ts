import type { TrendItem, TrendScore, TrendScoreReason } from '@threads-id/contracts';

export type TrendThemeHint = { id: string; name: string; examples: string[] };

/** Sumber yang dikenal publik & punya RSS stabil; bukan pernyataan kualitas isi. */
const TRUSTED_SOURCES = new Set(['detik', 'kompas', 'cnnindonesia', 'antaranews', 'republika']);

/** Kata kunci yang memperkuat kaitan dengan keseharian usia 20-an. */
const AUDIENCE_KEYWORDS = [
  'kerja', 'kuliah', 'kos', 'ngampus', 'gaji', 'kekinian', 'medsos', 'scroll', 'chat', 'teman',
  'ulang tahun', 'hemat', 'jajan', 'ongkir', 'produktif', 'lembur', 'resign', 'intern', 'uts', 'uas',
  'teknologi', 'ai', 'aplikasi', 'game', 'streaming', 'viral', 'trending', 'gen z', 'genz', 'remaja'
];

const RELEVANT_CATEGORIES = new Set([
  'teknologi', 'digital', 'gaya hidup', 'lifestyle', 'korea', 'hiburan', 'bisnis', 'ekonomi', 'pendidikan'
]);

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Skor relevansi 0–100 dengan alasan yang tercatat.
 * Ini bukan pernyataan benar/salahnya sebuah tren; hanya prioritas untuk review editor.
 */
export function scoreTrendItem(item: TrendItem, themes: TrendThemeHint[]): TrendScore {
  const reasons: TrendScoreReason[] = [];
  const haystack = normalize(`${item.title} ${item.summary ?? ''}`);

  // 1) Kedekatan tema: judul ringkas diminta supaya cocok dengan tema yang dipilih operator.
  let themeHits = 0;
  for (const theme of themes) {
    const words = normalize(theme.name).split(/\s+/).filter((word) => word.length >= 4);
    if (words.some((word) => haystack.includes(word))) themeHits += 1;
  }
  if (themeHits > 0) {
    const points = Math.min(40, 20 * themeHits);
    reasons.push({ label: 'Kedekatan tema', points, detail: `${themeHits} tema cocok` });
  } else {
    reasons.push({ label: 'Kedekatan tema', points: 0, detail: 'Tidak ada nama tema yang cocok' });
  }

  // 2) Kaitan dengan keseharian audiens.
  const audienceHits = AUDIENCE_KEYWORDS.filter((keyword) => haystack.includes(normalize(keyword)));
  if (audienceHits.length > 0) {
    const points = Math.min(25, 8 * audienceHits.length);
    reasons.push({ label: 'Kaitan audiens', points, detail: audienceHits.slice(0, 5).join(', ') });
  }

  // 3) Kebaruan: semakin baru semakin layak dipantau.
  if (item.publishedAt) {
    const ageHours = (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000;
    if (ageHours <= 24) reasons.push({ label: 'Kebaruan', points: 20, detail: `${Math.max(0, Math.round(ageHours))} jam lalu` });
    else if (ageHours <= 72) reasons.push({ label: 'Kebaruan', points: 10, detail: `${Math.round(ageHours / 24)} hari lalu` });
    else reasons.push({ label: 'Kebaruan', points: 0, detail: 'Lebih dari 3 hari' });
  } else {
    reasons.push({ label: 'Kebaruan', points: 0, detail: 'Tanpa waktu terbit' });
  }

  // 4) Sumber terpercaya (daftar tetap, bukan penilaian otomatis).
  if (TRUSTED_SOURCES.has(item.source)) {
    reasons.push({ label: 'Sumber dikenal', points: 15, detail: item.sourceName });
  }

  // 5) Kategori relevan.
  const categoryHits = item.categories.filter((category) => RELEVANT_CATEGORIES.has(normalize(category)));
  if (categoryHits.length > 0) {
    reasons.push({ label: 'Kategori relevan', points: 10, detail: categoryHits.slice(0, 3).join(', ') });
  }

  const score = Math.max(0, Math.min(100, reasons.reduce((sum, reason) => sum + reason.points, 0)));
  return { score, reasons };
}
