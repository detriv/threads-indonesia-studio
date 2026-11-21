import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {GenerationPanel} from './GenerationPanel.js';
it('kontrol konten menandai simulasi dan tidak menjanjikan tiga draft sebelum sukses',()=>{
 const html=renderToStaticMarkup(<GenerationPanel themes={[]} drafts={[]} sources={[]} onChanged={async()=>{}} />);
 expect(html).toContain('Coba tema');expect(html).toContain('Revisi');expect(html).toContain('tanpa jadwal');expect(html).toContain('Memuat konfigurasi');
 expect(html).not.toContain('3 draft berhasil');
});
