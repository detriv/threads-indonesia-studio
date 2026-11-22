import { describe, expect, it } from 'vitest';
import type { TrendSource } from '@threads-id/contracts';
import { parseFeed } from './trend-provider.js';

const source: TrendSource = { id: 'contoh', name: 'Contoh', url: 'https://contoh.test/rss' };

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title>Niat kerja dari rumah, hilang di grup chat</title>
  <link>https://contoh.test/a</link>
  <pubDate>Mon, 22 May 2026 03:00:00 +0700</pubDate>
  <description><![CDATA[Wacana <b>kiprah</b> yang berubah jadi scroll.]]></description>
  <category>pekerjaan</category>
</item>
<item><title>Tanpa tautan</title><description>harus dilewati</description></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>Kebiasaan digital: scroll sampai lupa waktu</title>
  <link href="https://contoh.test/b"/>
  <updated>2026-05-21T20:00:00Z</updated>
  <category term="teknologi"/>
</entry>
</feed>`;

describe('parseFeed (RSS/Atom, tanpa dependensi)', () => {
  it('RSS: judul, tautan, waktu, ringkasan dibersihkan dari HTML', () => {
    const items = parseFeed(rss, source);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.title).toContain('grup chat');
    expect(item.url).toBe('https://contoh.test/a');
    expect(item.summary).toBe('Wacana kiprah yang berubah jadi scroll.');
    expect(item.categories).toContain('pekerjaan');
    expect(item.publishedAt).toBeTruthy();
  });

  it('Atom: link href dan category term terbaca', () => {
    const items = parseFeed(atom, source);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe('https://contoh.test/b');
    expect(items[0]!.categories).toContain('teknologi');
  });

  it('entitas XML didekode, item tanpa judul/tautan dilewati', () => {
    const xml = `<rss version="2.0"><channel><item><title>Diskon &amp; ongkir &lt;sepuluh&gt; ribu</title><link>https://contoh.test/c</link></item></channel></rss>`;
    const items = parseFeed(xml, source);
    expect(items[0]!.title).toBe('Diskon & ongkir <sepuluh> ribu');
  });
});
