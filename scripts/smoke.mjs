const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';
const check = async (response, label) => { if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`); return response; };
await check(await fetch(`${base}/health`), 'health');
const created = await (await check(await fetch(`${base}/api/demo/actions`, { method: 'POST' }), 'create')).json();
if (!created.demo || created.status !== 'QUEUED' || !created.actionId) throw new Error('Respons create tidak valid');
let action;
for (let attempt = 0; attempt < 30; attempt += 1) {
  action = await (await check(await fetch(`${base}/api/demo/actions/${created.actionId}`), 'status')).json();
  if (action.status === 'COMPLETED') break;
  if (action.status === 'FAILED') throw new Error(`Worker gagal: ${action.error}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (action?.status !== 'COMPLETED' || action.result?.simulatedAgeSeconds !== 20) throw new Error(`Aksi tidak selesai: ${JSON.stringify(action)}`);
const history = await (await check(await fetch(`${base}/api/demo/actions`), 'history')).json();
if (!history.some((item) => item.id === created.actionId)) throw new Error('Aksi tidak ditemukan di riwayat');
console.log(JSON.stringify({ ok: true, actionId: created.actionId, status: action.status, historyCount: history.length }));
