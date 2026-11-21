# Threads Automation Indonesia

Dashboard editorial untuk satu admin dan satu akun Threads Indonesia, dengan fokus pada keseharian usia 20-an. **Fase 1 hanya simulasi lokal**: tidak ada akses Meta/Gemini atau publikasi nyata. Status verifikasi ada di `PHASE_STATE.md`.

## Jalankan lokal

Butuh Node.js 24+, npm, Docker, dan Docker Compose.

```bash
npm ci
# Hanya bila belum memiliki .env:
cp -n .env.example .env
npm run hash-password
docker compose up -d --build --wait
```

`npm run hash-password` meminta kredensial admin di terminal interaktif. Password tidak ditampilkan atau ditulis ke file; hash Argon2id disimpan ke `.env` berizin `0600`. Script hanya untuk setup awal; API tidak menimpa admin yang sudah ada dalam volume PostgreSQL. Jangan kirim password/hash melalui chat atau commit `.env`.

Buka `http://127.0.0.1:8080`. Web/proxy dan port DB host hanya bind loopback. Login diperlukan untuk API data. `docker compose down` menghentikan stack tanpa menghapus data. Jangan gunakan `-v` kecuali memang ingin menghapus data lokal.

## Struktur

- `apps/web`: dashboard React/Vite berbahasa Indonesia; Nginx mem-proxy `/api` di origin yang sama.
- `apps/api`: Fastify, sesi admin, tema/gaya, draft/review, jadwal, riwayat, dan status integrasi.
- `apps/worker`: pg-boss dan adapter simulasi lokal; tidak ada koneksi eksternal.
- `packages/contracts` dan `packages/db`: kontrak, akses PostgreSQL, dan migrasi `001_init.sql` lalu `002_editorial.sql`; API menerapkannya saat startup.

Lihat `docs/TESTING.md` untuk lint, typecheck, test PostgreSQL, smoke, dan verifikasi restart; `docs/ARCHITECTURE.md` untuk keputusan teknis. Penyimpanan waktu UTC, tampilan WIB (`Asia/Jakarta`).
