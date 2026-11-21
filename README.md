# Threads Automation Indonesia

Fondasi Phase 0 berupa monorepo npm workspaces untuk simulasi lokal yang aman. **Tidak ada integrasi, kredensial, atau panggilan ke Meta maupun Gemini.** Semua aksi berlabel DEMO dan hanya aktif saat `DEMO_MODE=true`.

## Arsitektur singkat

- `apps/web` — dashboard React/Vite berbahasa Indonesia, disajikan Nginx dan memakai API same-origin `/api`.
- `apps/api` — Fastify health check dan endpoint aksi simulasi.
- `apps/worker` — worker `pg-boss` yang mengklaim aksi secara atomik dan idempoten.
- `packages/contracts` — schema Zod, tipe bersama, nama job, dan status.
- `packages/db` — pool PostgreSQL, migrasi SQL, dan akses data bersama.
- `compose.yaml` — tepat empat service: `web`, `api`, `worker`, `db`.

## Menjalankan dengan Docker

```bash
cp .env.example .env
docker compose up -d --build --wait
npm run smoke
```

Dashboard: `http://localhost:8080`. Tombol **Jalankan simulasi** membuat UUID aksi, menyimpan status `QUEUED`, mengantrekan job, lalu worker mengubahnya menjadi `COMPLETED`. Data disimpan UTC dan ditampilkan dalam zona `Asia/Jakarta`.

Matikan tanpa menghapus data:

```bash
docker compose down
```

Hapus juga volume data lokal hanya bila memang diinginkan:

```bash
docker compose down -v
```

## Migrasi

API menjalankan migrasi idempoten saat startup. Untuk menjalankan manual dari host dengan `DATABASE_URL` yang dapat dijangkau:

```bash
npm run migrate
```

Migrasi: `packages/db/migrations/001_init.sql`.

## Pengembangan dan verifikasi

Memerlukan Node.js 24+ dan npm.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
npm audit
```

Lihat `docs/TESTING.md` untuk prosedur E2E dan restart persistence, serta `docs/ARCHITECTURE.md` untuk keputusan desain.

## Batas keamanan Phase 0

- Demo/lokal saja; belum ada autentikasi pengguna.
- Startup API dan worker gagal bila `DEMO_MODE` bukan `true`.
- Tidak ada endpoint Meta/Gemini palsu dan tidak ada kebutuhan kredensial eksternal.
- Phase 1 harus menambahkan autentikasi dan otorisasi sebelum akses non-lokal dipertimbangkan.
