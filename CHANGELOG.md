# Changelog

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
