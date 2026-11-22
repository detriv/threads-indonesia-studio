# Changelog

## Fase 4 — Tren, Reply, Discovery

**4A = LIVE VERIFIED (2026-11-22)** — discovery + skor + review. **4B = IMPLEMENTED / LIVE VERIFICATION PENDING (2026-11-22)** — antrean balasan, worker 2 langkah, API & panel Balasan; live balasan MATI (runtime: `REQUIRES_LIVE`), balasan nyata belum ada (perlu re-OAuth scope `threads_manage_replies` + izin live).

- Ditambahkan: migrasi `007_trend_discovery.sql` (trend_settings, trend_items, trend_candidates, trend_runs); kontrak `trend.ts`; `TrendRepository`; worker `trend-provider` (RSS/Atom, tanpa dependensi), `trend-scoring` (skor 0–100 + alasan audit), `trend-processor` + dispatcher; API `/api/trends/*`; menu dashboard **Tren**.
- Verifikasi nyata: 5 sumber RSS (detik, Kompas, CNN Indonesia, Antara, Republika) → 215 item, 115 baru, 5 draft `TREN_RELEVAN` berstatus `IN_REVIEW`, 0 kegagalan. Kegagalan sumber dicatat jujur (run pertama: CNN 404, Kumparan gagal, Tempo 403 → daftar bawaan dikoreksi).
- Gate: lint/typecheck 0; **89 unit + 101 integrasi PostgreSQL PASS**.
- Batas: discovery nonaktif/dijeda → tidak memproses; `daily_limit` ditegakkan; skor di bawah ambang tidak jadi draft; tidak ada kiriman otomatis ke Threads.

## Fase 3 — Posting Threads: COMPLETE

- Ditambahkan: kontrak Meta Threads (job name, batas 500 char, wait 30s, scope `threads_basic`+`threads_content_publish`), migrasi `006_threads_publish.sql`, API `/api/threads/*` (status koneksi, OAuth URL, callback GET publik + POST, toggle live, antrean publish, rekonsiliasi), worker 2 langkah container→publish, UI halaman Publikasi.
- Perilaku: live mati default → antrean `REQUIRES_LIVE` (tanpa post nyata); live aktif → `QUEUED` → `PUBLISHED` (media_id wajib) / `NEEDS_REVIEW` (ambigu after-send, rekonsiliasi operator) / `FAILED`.
- **Live verified**: akun `@lorem_ipsum7777` (user_id kanonik `29713621341597282`), token long-lived s/d 2027-01-21. Tiga post nyata status `PUBLISHED` dengan permalink tervalidasi Meta: `18033566909883283` (DgBw9cAEh37), `18114336386231777` (DgBxKWAkpxb), `17949796110358338` (DgBxqDnkjxK).
- Gate: lint/typecheck/build 0; **80 unit + 89 integrasi PostgreSQL PASS**, 0 gagal/skip. Commit `55658a0`; UI fix `83b4309`.
- Perbaikan saat live: ID kanonik diambil dari `GET /me` (token-exchange berbeda); `published_url` memakai permalink asli `threads.com/@<user>/post/<shortcode>`; dispatcher publish mengecek job aktif agar tidak mengirim duplikat tiap detik; panel Konten Gemini hanya di menu Draft.
- QA runtime nyata (stack terisolasi port 18093, live MATI): 12/12 skrip + browser Publikasi; antrean `REQUIRES_LIVE`, 0 panggilan Meta.
- **Review independen dilaporkan operator: lolos semua (2026-11-22) → Fase 3 COMPLETE.** Catatan: live saat ini ON; matikan via dashboard bila tidak dipakai; data draft pernah dibersihkan atas permintaan operator (3 post tetap hidup di Threads).

## Checkpoint terbaru — adaptasi teks prompt/chat (working tree, belum commit)

Bagian ini adalah status saat ini; histori checkpoint/provider di bawah dipertahankan. **Fase2 IN PROGRESS / IMPLEMENTED — LIVE VERIFICATION PENDING**, parent review adaptasi teks belum dilakukan. HEAD `61bf136`, runtime committed sebelumnya `6ea5314`; perubahan sekarang belum commit/push.

- Adapter tetap `generateContent` prompt/chat → plain text draft/caption; tanpa output JSON schema. Ordinary purpose1teks; Coba tema1call/attempt,3bagian strict → aplikasi menetapkan2pendek+1detail, normalized-distinct/<=500, tanpa jadwal. Semua guard editorial/concurrency/quota/fallback lama dipertahankan. Kontrak lengkap `docs/PHASE2.md`.
- Final gates aktual: `npm run lint && npm run typecheck && npm run test:all && npm run build && npm audit --audit-level=moderate && git diff --check` exit0, **62unit/behavior+71integrasi PostgreSQL**,0gagal/skip,5workspace build/typecheckPASS,audit0. Tests transport adalah mock lokal, bukan Gemini nyata. RED/GREEN rinci ada di WORKLOG.
- Isolated simulation smoke fresh+full restart exit0: project `threads-phase2-qa-1a377dde`, **18092/15449**, evidence `/home/deva/.hermes/cache/scratch/threads-phase2-vJGVZK/evidence.json`;7request/7attempt,0jadwal. API/worker QA direbuild lagi setelah hardening parser terakhir; SQL readback tetap7/7/0. Stack QA baru dibiarkanrunning; tidak hapus volume/ubah stack QA lama. Main8080 `/health`200/demo=true; tidak redeploy utama, tidak sentuh `.env`/admin/volume utama.
- **0 panggilan outbound Gemini/Threads** pada adaptasi ini. Hydrogen sebelumnya FAILED/PROVIDER lalu diagnostic TIMEOUT45000ms tetap belum terjelaskan; perubahan teks bukan klaim memperbaiki root cause atau sukses live. Model/secret tidak diubah. Publikasi Threads API hanya Fase3 (belum dimulai).
- Next exact action: parent inspeksi diff/parser/prompt, rerun critical transport+PostgreSQL tests dan readback QA evidence sebelum commit apa pun. Live berikut memerlukan izin/budget baru; jangan push/deploymain/lanjutFase3/markCOMPLETE. Tidak ada harness background; hanya stack QA running.


## Review blockers follow-up — tetap IN PROGRESS

- Ketiga blocker reviewer diperbaiki: normalisasi-distinct/mix reguler Coba tema + validasi evidence selalu; approval reguler invalid setelah edit/revisi substantif; commit provenance guard terhadap FK source deletion meski versi tidak berubah.
- RED→GREEN aktual tercatat di WORKLOG; final **35 unit + 69 PostgreSQL integration**, 0 gagal/skip, lint/typecheck/build5/audit0/diff-check PASS. Parent review ulang/live Gemini masih PENDING; tidak commit/push.
- Smoke diperkuat untuk contoh500karakter, tiga teks unik dan approval invalidation, fresh/restart PASS di project baru `threads-phase2-qa-ee6464df` **18089/15446**. Evidence `/home/deva/.hermes/cache/scratch/threads-phase2-sPH57T/evidence.json`; envFile sibling `compose.env`. Main dan seluruh QA sebelumnya tidak diubah oleh follow-up ini.

## Fase 2 — Konten Gemini (IN PROGRESS, belum commit)

- Durable generation request/attempt tables (migrasi additive 005), dispatcher queue exclusive, provider simulasi dan REST resmi opt-in, structured output tervalidasi, prompts suara/sumber terpilih, tiga draft Coba tema tanpa jadwal.
- Revisi version/lock-safe memakai policy jadwal/snapshot Fase 1; generasi quota terpisah, model per fungsi, pemakaian dan biaya null jika tidak diketahui, error sanitasi dan fallback approved reguler benar-benar diambil tanpa mutasi.
- UI Konten Gemini berbahasa Indonesia, persetujuan cadangan, pemakaian/gagal/fallback dan kontrol generate/revise. Key hanya worker, Meta/publication live tetap mati.
- 35 unit/behavior + 69 integrasi PostgreSQL PASS, lint/typecheck/build lima workspace PASS, audit 0. Smoke terbaru `threads-phase2-qa-ef721d39` 18087/15444 PASS termasuk queued-restart; browser pada `threads-phase2-qa-4f73217b` 18086/15443.
- `docs/PHASE2.md`, `scripts/phase2-smoke.mjs`, screenshot `docs/qa/phase2-*.png`. Semua rincian RED/GREEN, IDs, batas bukti ada di WORKLOG.
- Live Gemini belum diuji: key/izin outbound tidak tersedia. Parent review/closure PENDING; Fase 1 tetap COMPLETE dan Fase 3 belum dimulai. Tidak commit/push.

## Phase 0 — 2026-11-21

### Added

- npm workspaces and pinned `package-lock.json`.
- React/Vite Indonesian DEMO dashboard and Nginx same-origin proxy.
- Fastify health, create, status, and history endpoints.
- pg-boss worker with atomic/idempotent processing.
- Zod contracts and shared PostgreSQL repository/migration.
- Four-service Docker Compose stack with healthchecks and persistent volume.
- Unit/behavior tests and Docker smoke script.
- README, architecture, roadmap, testing, state, task, phase, changelog, and detailed worklog documents.

### Verification

- Lint/typecheck/build/test passed.
- npm audit reported zero vulnerabilities after dependency updates.
- Docker E2E after final local-only bind completed action `7c7778b6-ef42-46fd-9e41-fa6331645cc0`.
- Same action remained completed and in history after stack recreation without volume deletion.

### Commit

- Focused commit message: `Phase 0: fondasi dan alur simulasi end-to-end`.
- Base commit: `6150620`.

### Post-handoff correction

- Independent audit found the initial job payload had only an action ID and did not carry the required synthetic everyday-life content.
- Added validated `KEBIASAAN_DIGITAL` / `OBSERVASI_PENDEK` editorial payload from API through pg-boss to worker result.
- Updated dashboard wording and smoke assertions to verify the real editorial sample.
- Re-ran lint, typecheck, 4 tests, build, audit, Docker smoke, browser UI flow, and persistence verification.
- Verified runtime correction commit: `d7a1310`.

## Fase 1 — Dashboard editorial (simulasi lokal)

- Backend editorial, login admin, jadwal/outbox, worker simulasi lokal, riwayat dan status integrasi tersimpan pada runtime commit `7bea826`.
- Pemulihan memperbaiki compile TypeScript, validasi set bobot tema, bootstrap admin dan urutan startup Compose. Smoke sekarang terautentikasi.
- Runtime commit `7bea826`. Dashboard, backend dan persistensi E2E lulus; reviewer independen menyetujui tiga perbaikan. 17 unit + 52 integrasi PASS; QA manual pengguna juga PASS; Fase 1 COMPLETE.
- Snapshot riwayat immutable dan rekonsiliasi review memakai migrasi additive 003/004; kuota jadwal konkuren diserialisasi untuk satu akun. Lihat `WORKLOG.md`.

### Checkpoint terverifikasi Fase 2

- Runtime `6ea5314`; review independen ulang approved untuk simulasi+mocked-provider. Parent35unit+69integrasi/lint/typecheck/build/audit0 PASS, enhanced smoke fresh/restart PASS.
- Status IMPLEMENTED / LIVE VERIFICATION PENDING: tidak ada key/izin outbound; tidak diklaim Gemini live. Main image belum diredeploy.


## Uji Gemini nyata terbatas — 2026-11-22 WIB (belum berhasil)

Bagian ini menggantikan keterangan lama bahwa key/izin belum tersedia. Operator mengizinkan hanya uji generasi Gemini terbatas; secret diambil dari `.env` lokal, tidak dari chat. Main8080/admin/data/image tidak diubah, tidak ada publikasi/Meta, tidak commit/push dan Fase3 belum dimulai. Fase2 tetap **IMPLEMENTED / LIVE VERIFICATION PENDING**, bukan COMPLETE.

- Recovery aktual: Git clean `main`/`32dc486`, runtime `6ea5314`; `npm run test:all && npm run build` exit0:35 unit+69 PostgreSQL integration PASS,0 failed/skip; build5workspace PASS. Main `/health` tetap200/demo=true.
- Dokumentasi resmi https://ai.google.dev/api/models diambil langsung HTTP200; snapshot `/home/deva/.hermes/cache/scratch/gemini-official-models.html`. GET resmi `/v1beta/models` memakai header `x-goog-api-key`, HTTP200/1page; snapshot nonsecret `/home/deva/.hermes/cache/scratch/threads-gemini-model-list.json`. Daftar mendukung generateContent termasuk stable Flash-Lite2.5 dan3.5; models.list tidak menjamin akses generasi nyata.
- `.env` awal: key present, provider=gemini, outbound=true, model dan seluruh override fungsi blank, pricing tidak diisi. Hanya `GEMINI_MODEL` yang awalnya kosong diisi; akhir `gemini-3.5-flash-lite`, mode0600, seluruh field lain dipertahankan. Model2.5 awal yang dipilih dari daftar dikoreksi karena404 unavailable. Default akhir bukan klaim output berhasil. QA memakai provider=gemini/outbound=true; key hanya worker, API tanpa key, DEMO_MODE=true; blank override memakai fallback.
- QA fresh: `threads-gemini-live-7354c655`, web **18091**, DB **15448**, empat service terisolasi; tidak menyentuh volume utama. Env sensitif `/home/deva/.hermes/cache/scratch/threads-gemini-live-Fi0f1D/compose.env`0600: jangan dicetak/dibaca ke chat. Fixture sesi browser sibling `browser-fixture.json`0600; login hanya HTTP fixture, bukan form browser.
- **Total3 generation HTTP calls, berhenti pada batas**: (1) Coba tema2.5 request `d170c7d3-c0c4-4f95-9b1d-e58b426a0d8f` FAILED/PROVIDER, attempt `c20dc024-a70f-4c62-a21b-3f19b2e8a4d8`; (2) diagnostik host payload adapter identik2.5, HTTP404 Google NOT_FOUND: `This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements. We recommend you to use the Interactions API (https://aistudio.google.com/docs/get-started).`; (3) satu alternatif kompatibel dari models.list3.5 Coba tema request `7c8ef206-579e-468c-9b6a-d62658f80a2f` FAILED/INVALID_OUTPUT, attempt `28e8a6fd-9212-43a5-9959-340b72dfbd1d`. Tidak ada retry quota evasion atau panggilan keempat.
- DB/API readback:2requests/2failed/2attempts/0UNKNOWN; diagnostik host tidak masukDB. **0 draft,0 jadwal**. usage/modelVersion/cost semuanya null/tidak diketahui; bukan pemakaian atau biaya nol. Actual modelVersion dan kualitas teks Indonesia/gaya belum dapat diverifikasi. Penyebab INVALID_OUTPUT spesifik tidak diketahui karena adapter menyamarkan detail dan tidak menyimpan respons gagal; tidak mengarang teks/usage dan tidak mengubah kode produksi tanpa RED/GREEN.
- Bukti nonsecret sibling: `evidence.json` (request awal), `diagnostic.json` (404 teredaksi), `alternative-evidence.json` (readback akhir). Harness bounded di scratch `threads-gemini-{discover,live,diagnose,alternative}.mjs`; source tidak memuat key literal. Handle `/home/deva/.hermes/cache/scratch/threads-gemini-live-handle.json`.
- Next exact action: parent verifikasi read-only IDs/evidence/stack; minta izin terpisah untuk diagnostik output baru jika diperlukan (batas3call habis). Bila bug dibuktikan, RED/GREEN sebelum perbaikan. Jangan deploy main, lanjutFase3 atau markCOMPLETE. Stack QA ditinggal running untuk review; tidak ada proses harness background. Stop hanya project ini via Compose envfile/project di atas, tanpa `-v`.

## Uji Hydrogen yang diizinkan — 2026-11-22 WIB

Izin baru terbatas untuk Gemini 4 Hydrogen saja, maksimal2 generateContent; bukan izin fallback model atau migrasi Interactions. Recovery `main` clean HEAD `e23e7c7`, runtime `6ea5314`. `npm run test:all && npm run build` exit0:35unit+69integrasi PostgreSQL PASS,0gagal/skip; build5workspace PASS.

- GET resmi `https://generativelanguage.googleapis.com/v1beta/models` via header `x-goog-api-key`, HTTP200,1page lengkap/65model, memuat **`models/gemini-4-hydrogen`**, displayName Gemini 4 Hydrogen, methods `generateContent`, `countTokens`, `batchGenerateContent`. Bukti0600 `/home/deva/.hermes/cache/scratch/threads-hydrogen-discovery.json`; dokumentasi resmi models HTTP200 disimpan `threads-hydrogen-official-models.html` di scratch yang sama. Terdaftar bukan jaminan akses generasi berhasil.
- Hanya GEMINI_MODEL pada `.env` lokal dan envFile QA yang diubah ke `gemini-4-hydrogen` (ID resmi tanpa prefix resource `models/`, sesuai adapter). Readback model benar; mode0600; key/field lain dipertahankan, seluruh override fungsi blank. Ini **konfigurasi percobaan, bukan model default tervalidasi**. Main8080/image/admin/data tidak diredeploy/diubah.
- QA existing `threads-gemini-live-7354c655`18091/15448: API/worker/web diperbarui konfigurasi saja,4servicehealthy. Inspect tersaring membuktikan key hanya worker, bukan API/web; API+worker DEMO_MODE=true. Fixture cookies tersimpan digunakan diam-diam, tidak mengetik password atau mengubah admin.
- **1 generateContent application attempt pada izin baru,0diagnostic call**. Coba tema request **`2373db37-984c-4332-986a-50c7dc5374a0`**, attempt **`6f46f587-2457-4ab6-86ee-7f342a49490a`**, GEMINI/gemini-4-hydrogen → **FAILED / PROVIDER**. Berhenti: izin diagnostic bersyarat INVALID_OUTPUT tidak berlaku pada error ini. HTTP status/body/alasan provider spesifik tidak tertangkap adapter; jangan menyebutnya404/quota/incompatibility tanpa bukti. Tidak mencoba model lain/retry/Interactions.
- Readback exact request/attempt dan API:0draft dari request ini,0schedule; total QA3requests/3failed/3attempts/0UNKNOWN. actual_model/usage/cost null (tidak diketahui, bukan nol). Belum ada bukti3draftdistinct/mixed atau kualitas/gaya Indonesia nyata. Batas aplikasi dailyLimit3 sudah tercapai; tidak dinaikkan untuk mengelak kuota.
- Evidence0600 `/home/deva/.hermes/cache/scratch/threads-hydrogen-live-evidence.json`; harness source tanpa key literal `threads-hydrogen-{discovery,live}.mjs` di scratch yang sama. Tidak ada background harness; QA ditinggal running untuk parent readback. Main `/health` HTTP200/demo=true; `git diff --check` PASS. Tidak ada code fix/regression baru karena belum ada bug yang terbukti; tidak ada Meta/posting/commit/push.
- Status tetap **Fase2 IMPLEMENTED / LIVE VERIFICATION PENDING / IN PROGRESS**, bukan COMPLETE. Next exact action: parent verifikasi request/attemptDB dan evidence; jika ingin diagnosis error PROVIDER baru, perlu izin terpisah yang secara eksplisit mencakup satu diagnostic call persis payload/model, tanpa retry/fallback atau ubah quota. Dua call maksimum adalah batas, bukan kewajiban menghabiskan budget.

### Diagnostic Hydrogen eksplisit — budget2/2 terpakai

Parent kemudian mengonfirmasi readbackDB FAILED/PROVIDER,0draft/0schedule dan secara eksplisit mengizinkan tepat1 diagnostic call untuk kegagalan PROVIDER. Izin baru ini menggantikan syarat diagnostic sebelumnya. Menjalankan `node /home/deva/.hermes/cache/scratch/threads-hydrogen-diagnostic.mjs` sekali: adapter `callGemini` yang sama, input/context tersimpan request `2373db37-984c-4332-986a-50c7dc5374a0`, model listed `gemini-4-hydrogen`, exact application payload; key hanya dibaca diam-diam dari `.env` server untuk header resmi, tidak dicetak/disimpan dalam evidence.

- Diagnostic mulai `2026-11-21T17:27:40.392Z`, berakhir `2026-11-21T17:28:25.428Z`: **TIMEOUT pada batas adapter45000ms sebelum respons HTTP diterima**. Actual HTTPstatus=null; Google code/message=null; response headers/retry-after=null; actualModel/usage=null. Ini bukan HTTP error tertentu atau bukti quota/unavailability; penyebab PROVIDER pertama tetap tidak diketahui. Tidak mengarang status/message yang tidak diterima.
- **Total Hydrogen2 generateContent calls**:1application+1host diagnostic; budget habis. Tidak retry, fallback, model switch, atau Interactions. Host diagnostic tidak membuat requestDB/draft/jadwal dan bukan bukti aplikasi sukses. Tidak ada produksi code edits/commit/push/main deploy; konfigurasi dan secret tidak diubah pada diagnostic.
- Evidence sanitized0600: `/home/deva/.hermes/cache/scratch/threads-hydrogen-diagnostic.json`; harness source sibling `threads-hydrogen-diagnostic.mjs`, guard file eksklusif mencegah rerun. Respons bila ada disanitasi literal key sebelum write; pada eksekusi ini tidak ada respons yang bisa direkam. Tests/build35+69/5workspace sebelumnya tetap bukti recovery, tidak diulang untuk perubahan dokumentasi saja.
- Fase2 tetap IMPLEMENTED / LIVE VERIFICATION PENDING / IN PROGRESS. Rekomendasi: parent baca evidence; periksa akses akun/model dan status layanan/jaringan secara read-only. Jangan menyimpulkan model tak tersedia atau mengganti API/model otomatis; panggilan generation berikut memerlukan izin/budget baru, bukan retry diam-diam. Tidak ada background diagnostic process.

## Checkpoint respons teks Gemini

- Runtime terbaru `98dcf15`: prompt API Gemini → jawaban teks biasa → draft; API Threads hanya publikasi pada Fase3, belum dimulai. Satu provider call per attempt; Coba tema tiga bagian teks tervalidasi dengan format dikelola aplikasi.
- Parent full gates PASS:62unit+71integrasi PostgreSQL,0gagal/skip; lint/typecheck/build5workspace/audit0. Reviewer independen APPROVED dan39targeted provider tests PASS. Tidak ada outbound Gemini tambahan.
- Simulasi/mock terverifikasi; uji live format baru PENDING. Hydrogen PROVIDER/timeout45s sebelumnya belum terdiagnosis/fixed. Main8080 belum diredeploy; tidak push. Review implementasi telah selesai; next exact action adalah uji live terbatas dengan persetujuan, bukan mengulang review yang sudah approved.
