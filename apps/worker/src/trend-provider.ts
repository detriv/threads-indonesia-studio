import type { TrendItem, TrendSource } from '@threads-id/contracts';

export type TrendTransport = typeof fetch;

/** Meta/umum: RSS & Atom publik jarang lambat, tapi jangan biarkan menggantung. */
export const TREND_FETCH_TIMEOUT_MS = 20_000;

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_match: string, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match: string, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeCodePoint(value: number): string {
  try { return String.fromCodePoint(value); } catch { return ''; }
}

function stripTags(input: string): string {
  const withoutCdata = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(withoutCdata.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function atomLink(block: string): string {
  const match = block.match(/<link\b[^>]*\bhref\s*=\s*"([^"]+)"/i) ?? block.match(/<link\b[^>]*\bhref\s*=\s*'([^']+)'/i);
  const value = match?.[1];
  return value ? decodeEntities(value.trim()) : '';
}

function allMatches(input: string, pattern: RegExp): string[] {
  const result: string[] = [];
  for (const match of input.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined) result.push(value);
  }
  return result;
}

/** RSS 2.0 memakai <item>, Atom memakai <entry>. Keduanya diparsing tanpa dependensi. */
export function parseFeed(xml: string, source: TrendSource): Array<Omit<TrendItem, 'id' | 'fetchedAt' | 'raw'>> {
  const blocks = [
    ...allMatches(xml, /<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...allMatches(xml, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)
  ];
  const items: Array<Omit<TrendItem, 'id' | 'fetchedAt' | 'raw'>> = [];
  for (const block of blocks) {
    const title = stripTags(tag(block, 'title'));
    const link = tag(block, 'link') ? stripTags(tag(block, 'link')) : atomLink(block);
    if (!title || !link) continue;
    const summaryRaw = tag(block, 'summary') || tag(block, 'description');
    const publishedRaw = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'date');
    const categories = [
      ...allMatches(block, /<category\b[^>]*\bterm\s*=\s*"([^"]+)"/gi),
      ...allMatches(block, /<category\b[^>]*\bterm\s*=\s*'([^']+)'/gi),
      ...allMatches(block, /<category\b[^>]*>([\s\S]*?)<\/category>/gi).map(stripTags)
    ].map((value) => value.trim()).filter(Boolean);
    const publishedAt = publishedRaw ? new Date(publishedRaw) : null;
    items.push({
      source: source.id,
      sourceName: source.name,
      title,
      url: link,
      summary: summaryRaw ? stripTags(summaryRaw).slice(0, 500) : null,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt.toISOString() : null,
      categories: [...new Set(categories)].slice(0, 8)
    });
  }
  return items;
}

/** Ambil satu sumber; kegagalan satu sumber tidak menggagalkan sumber lain. */
export async function discoverFromSource(
  source: TrendSource,
  transport: TrendTransport = fetch
): Promise<Array<Omit<TrendItem, 'id' | 'fetchedAt' | 'raw'>>> {
  const response = await transport(source.url, {
    signal: AbortSignal.timeout(TREND_FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'ThreadsIndonesiaStudio/1.0 (+dashboard editorial)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} dari ${source.name}`);
  const xml = await response.text();
  return parseFeed(xml, source);
}
