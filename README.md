# Threads Indonesia Studio

Dashboard editorial untuk satu admin dan satu akun Threads Indonesia, fokus pada keseharian usia 20-an.

**Repo:** https://github.com/detriv/threads-indonesia-studio · **Visibility:** public

**Status fase**

| Fase | Status |
|---|---|
| 0 — Fondasi + simulasi | COMPLETE |
| 1 — Dashboard editorial | COMPLETE |
| 2 — Konten Gemini | IMPLEMENTED / LIVE VERIFICATION PENDING |
| 3 — Posting Threads | COMPLETE — live terverifikasi |

Fase 3 sudah terbukti end-to-end dengan post nyata ke Threads (container → publish → `media_id` + permalink). **Publikasi live tetap MATI secara default** dan hanya aktif setelah operator menyetelnya di dashboard. Detail verifikasi ada di `PHASE_STATE.md` dan `WORKLOG.md`; rencana kerja di `docs/ROADMAP.md`.

## Jalankan lokal

Butuh Node.js 24+, npm, Docker, dan Docker Compose.

```bash
npm ci
# Hanya bila belum memiliki .env:
cp -n .env.example .env
npm run hash-password
docker compose up -d --build --wait
```

`npm run hash-password` meminta kredensial admin di terminal interaktif. Password tidak ditampilkan atau ditulis ke file; hash Argon2id disimpan ke `.env` berizin `0600`. Script hanya untuk setup awal; API tidak menimpa admin yang sudah ada dalam volume PostgreSQL. Jangan kirim password/hash melalui chat dan jangan commit `.env` (sudah ada di `.gitignore`).

Buka `http://127.0.0.1:8080`. Web/proxy dan port DB host hanya bind loopback. Login diperlukan untuk API data. `docker compose down` menghentikan stack tanpa menghapus data; jangan gunakan `-v` kecuali memang ingin menghapus data lokal.

## Menu dashboard

| Menu | Isi |
|---|---|
| Ringkasan | metrik, porsi format, koneksi layanan, simulasi lokal, eksekusi terbaru |
| Tema & Gaya | pilar editorial, bobot tema, campuran format, batas/jeda, contoh suara, catatan pemilik, topik review |
| Draft | editor draft + **Konten Gemini** (ide, post pendek, bahasan, revisi, coba tema) |
| Review tren | gerbang draft `TREN_RELEVAN` (sumber, waktu, relevansi) |
| Jadwal | jadwal simulasi publikasi (Asia/Jakarta) |
| Publikasi | koneksi Meta Threads, toggle live, antrean & hasil publish |
| Riwayat | filter eksekusi berdasarkan status/tema/format/tanggal |
| Integrasi | status koneksi eksternal |

## Publikasi Threads (Fase 3)

Alur resmi: **OAuth Meta → antrean worker → container → publish**. Tanpa live, antrean dicatat `REQUIRES_LIVE` dan **tidak ada post nyata**.

### 1. Siapkan aplikasi Meta

1. Meta for Developers → buat app (tipe use case: **Access the Threads API**).
2. Dashboard app → isi **App Domains** dan **Redirect Callback URLs** dengan:
   `https://<host-publik-kamu>/api/threads/oauth-callback`
   Meta menolak `http` — pakai tunnel HTTPS (mis. `cloudflared tunnel --url http://127.0.0.1:8080`) bila belum punya domain.
3. App roles → **Roles → Threads Testers → Add People**, tambahkan akun Threads yang akan dipakai.
4. Di Threads (akun yang sama): **Settings → Account → Website permissions → Invites → Accept**.
   Akun Threads juga harus **publik**. Tanpa ini Meta membalas error `1349245` ("user has not accepted the invite").

### 2. Kunci environment

Isi di `.env` (mode `0600`):

```bash
THREADS_APP_ID=
THREADS_APP_SECRET=
THREADS_OAUTH_REDIRECT=https://<host-publik>/api/threads/oauth-callback
THREADS_LIVE_POSTING=false      # default mati
THREADS_ACCESS_TOKEN=           # opsional; kalau diisi, dipakai worker
THREADS_USER_ID=                # opsional; ID kanonik diambil dari /me saat OAuth
THREADS_TOKEN_FILE=/tmp/threads-worker-token
```

### 3. Hubungkan dari dashboard

**Publikasi → Buka halaman OAuth Meta → login Threads → Authorize**. Callback publik menyimpan koneksi (hanya *presence* token + kedaluwarsa; **nilai token tidak masuk DB**, disimpan di file `0600` di worker). Halaman Publikasi lalu menampilkan `user_id` kanonik, sisa kedaluwarsa, dan kuota.

### 4. Kirim post

- **Publikasi → Aktifkan live** (switch).
- Pilih draft → **Kirim ke antrean Meta**.
- Worker mengambil antrean (klaim atomik), membuat container, menunggu ±30 detik, lalu publish.
- Status: `QUEUED` → `CONTAINER_CREATED` → `PUBLISHED` (media_id wajib) / `NEEDS_REVIEW` (hasil ambigu, rekonsiliasi operator, **tanpa kirim ulang buta**) / `FAILED` / `DUPLICATE`.
- Batas teks 500 karakter ditegakkan API **dan** trigger PostgreSQL.

### 5. Matikan live

**Publikasi → Matikan live**. Koneksi tetap tersimpan; token tetap berlaku.

## Struktur

- `apps/web`: dashboard React/Vite berbahasa Indonesia; Nginx mem-proxy `/api` di origin yang sama.
- `apps/api`: Fastify, sesi admin, tema/gaya, draft/review, jadwal, riwayat, status integrasi, dan rute Threads OAuth/publish.
- `apps/worker`: pg-boss, publikasi Threads (container → publish), generasi Gemini/simulasi, adapter jadwal.
- `packages/contracts` dan `packages/db`: kontrak, akses PostgreSQL, dan migrasi additive/idempotent `001`–`006` (`006_threads_publish.sql`); API menerapkannya saat startup.

## Verifikasi dan kualitas

- `docs/TESTING.md` — lint, typecheck, test PostgreSQL, smoke, verifikasi restart.
- `docs/ARCHITECTURE.md` — keputusan teknis.
- `docs/PHASE2.md` — konfigurasi & batas bukti Fase 2.
- `WORKLOG.md`, `CHANGELOG.md`, `PHASE_STATE.md`, `CURRENT_TASK.md`, `AGENT_STATE.md` — catatan kerja dan checkpoint.
- Penyimpanan waktu UTC, tampilan WIB (`Asia/Jakarta`).

## Batas penting

- Token Meta tidak pernah ditampilkan dashboard dan tidak disimpan di DB.
- Live default mati; aktivasi hanya lewat dashboard oleh operator.
- Simulasi/bukti mock bukan bukti layanan eksternal berhasil; lihat catatan verifikasi sebelum menyimpulkan.
