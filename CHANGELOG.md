# Changelog

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
