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
