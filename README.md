# Threads Automation Indonesia

Dashboard editorial untuk satu admin dan satu akun Threads Indonesia, dengan fokus pada keseharian usia 20-an. **Fase 1 COMPLETE, Fase 2 IN PROGRESS**: generasi konten default simulasi, adapter Gemini resmi opt-in menerima prompt/chat dan mengembalikan teks draft/caption; uji live belum berhasil. Metadata milik aplikasi; publikasi Threads API baru Fase3. Adaptasi teks bukan klaim memperbaiki kegagalan Hydrogen sebelumnya. Publikasi Meta tetap simulasi/nonaktif. Lihat [konfigurasi dan batas bukti Fase 2](docs/PHASE2.md). Status verifikasi ada di `PHASE_STATE.md`.

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
- `apps/worker`: pg-boss, publikasi simulasi lokal, dan generasi konten simulasi/Gemini opt-in.
- `packages/contracts` dan `packages/db`: kontrak, akses PostgreSQL, dan migrasi additive/idempotent `001` sampai `005`; API menerapkannya saat startup.

Lihat `docs/TESTING.md` untuk lint, typecheck, test PostgreSQL, smoke, dan verifikasi restart; `docs/ARCHITECTURE.md` untuk keputusan teknis. Penyimpanan waktu UTC, tampilan WIB (`Asia/Jakarta`).
