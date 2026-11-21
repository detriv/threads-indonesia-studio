import { useCallback, useEffect, useState } from 'react';
import type { DemoAction } from '@threads-id/contracts';

const jakarta = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Jakarta' });
const labels: Record<DemoAction['status'], string> = { QUEUED: 'Antre', PROCESSING: 'Diproses', COMPLETED: 'Selesai', FAILED: 'Gagal' };

export function App() {
  const [actions, setActions] = useState<DemoAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/demo/actions');
      if (!response.ok) throw new Error('Gagal memuat riwayat');
      setActions(await response.json() as DemoAction[]);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kesalahan tidak dikenal'); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 1500); return () => window.clearInterval(timer); }, [load]);
  const run = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/demo/actions', { method: 'POST' });
      if (!response.ok) throw new Error('Simulasi gagal dimulai');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kesalahan tidak dikenal'); }
    finally { setBusy(false); }
  };
  return <main>
    <header><span className="badge">DEMO / LOKAL SAJA</span><h1>Threads Automation Indonesia</h1><p>Fondasi aman untuk simulasi—tanpa koneksi Meta atau Gemini.</p></header>
    <section className="panel hero"><div><h2>Simulasi aksi sintetis</h2><p>Membuat aksi unik berusia simulasi 20 detik, memasukkannya ke antrean, lalu memprosesnya secara idempoten.</p></div><button disabled={busy} onClick={() => void run()}>{busy ? 'Menjalankan…' : 'Jalankan simulasi'}</button></section>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="panel"><div className="section-title"><h2>Riwayat</h2><span>{actions.length} aksi</span></div>
      {actions.length === 0 ? <p className="empty">Belum ada simulasi.</p> : <div className="table-wrap"><table><thead><tr><th>ID aksi</th><th>Status</th><th>Waktu Jakarta</th><th>Hasil</th></tr></thead><tbody>{actions.map((action) => <tr key={action.id}><td><code>{action.id}</code></td><td><span className={`status ${action.status.toLowerCase()}`}>{labels[action.status]}</span></td><td>{action.createdAt ? jakarta.format(new Date(action.createdAt)) : '—'}</td><td>{action.result?.message ?? action.error ?? 'Menunggu worker…'}</td></tr>)}</tbody></table></div>}
    </section>
    <footer>Semua timestamp disimpan dalam UTC dan ditampilkan dalam zona Asia/Jakarta.</footer>
  </main>;
}
