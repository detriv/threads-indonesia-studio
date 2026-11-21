# Roadmap

## Phase 0 — Fondasi dan simulasi end-to-end

- Monorepo web/API/worker/contracts/db.
- Docker Compose empat service dengan volume PostgreSQL.
- Aksi sintetis unik, antrean `pg-boss`, worker idempoten, status, dan riwayat.
- Dashboard Indonesia dengan label DEMO.
- Lint, typecheck, build, unit tests, smoke E2E, dan restart persistence.

## Phase 1 — Keamanan akses

- Autentikasi dan otorisasi.
- Session management, CSRF/rate limiting, audit log, dan secret management.
- Tetap mempertahankan demo mode; belum mengaktifkan integrasi eksternal tanpa spesifikasi dan persetujuan terpisah.

## Phase berikutnya

Belum ditentukan. Integrasi Meta/Gemini atau aksi nyata tidak boleh diasumsikan dan memerlukan spesifikasi, kredensial aman, kebijakan platform, serta persetujuan eksplisit.
