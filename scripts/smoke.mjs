const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';
const check = async (response, label) => { if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`); return response; };
await check(await fetch(`${base}/health`), 'health');
const username = process.env.SMOKE_ADMIN_USERNAME;
const password = process.env.SMOKE_ADMIN_PASSWORD;
if (!username || !password) throw new Error('Set SMOKE_ADMIN_USERNAME dan SMOKE_ADMIN_PASSWORD melalui environment lokal, bukan argumen.');
const login = await check(await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password })
}), 'login');
const cookies = Object.fromEntries(login.headers.getSetCookie().map((entry) => entry.split(';')[0].split('=')));
if (!cookies.sid || !cookies.csrf) throw new Error('Cookie sesi dan CSRF tidak tersedia');
const headers = { cookie: `sid=${cookies.sid}; csrf=${cookies.csrf}`, 'x-csrf-token': cookies.csrf };
const created = await (await check(await fetch(`${base}/api/demo/actions`, { method: 'POST', headers }), 'create')).json();
if (!created.demo || created.status !== 'QUEUED' || !created.actionId) throw new Error('Respons create tidak valid');
let action;
for (let attempt = 0; attempt < 30; attempt += 1) {
  action = await (await check(await fetch(`${base}/api/demo/actions/${created.actionId}`, { headers }), 'status')).json();
  if (action.status === 'COMPLETED') break;
  if (action.status === 'FAILED') throw new Error(`Worker gagal: ${action.error}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (
  action?.status !== 'COMPLETED'
  || action.result?.editorialSample?.pillar !== 'KEBIASAAN_DIGITAL'
  || action.result?.editorialSample?.format !== 'OBSERVASI_PENDEK'
  || !action.result?.editorialSample?.text?.includes('cek jam')
) throw new Error(`Aksi tidak selesai dengan payload editorial: ${JSON.stringify(action)}`);
const history = await (await check(await fetch(`${base}/api/demo/actions`, { headers }), 'history')).json();
if (!history.some((item) => item.id === created.actionId)) throw new Error('Aksi tidak ditemukan di riwayat');
await check(await fetch(`${base}/api/auth/logout`, { method: 'POST', headers }), 'logout');
console.log(JSON.stringify({ ok: true, actionId: created.actionId, status: action.status, historyCount: history.length }));
