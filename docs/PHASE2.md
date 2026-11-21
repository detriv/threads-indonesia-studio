# Fase 2 — Konten Gemini (IMPLEMENTED, live verification pending)

Fase 1 tetap COMPLETE (`7bea826`). Fase 3 belum dimulai. Tidak ada publikasi/reply Meta live. `.env`/admin/volume utama tidak diubah oleh implementasi ini.

## Jalur pengguna

Buka **Draft** atau **Tema & Gaya → Konten Gemini**. Pilih tema/fungsi: Ide konten, Post pendek, Bahasan lebih dalam, Revisi, atau **Coba tema**. Coba tema sukses menyimpan **tepat tiga draft berbeda setelah normalisasi Unicode NFKC, whitespace dan huruf kecil**, wajib campuran observasi pendek/bahasan lebih dalam reguler (tidak boleh semua satu format atau mengandung tren), dalam satu transaksi; tidak pernah membuat jadwal. Fungsi lain menyimpan satu draft (IDEAS berupa ide konkret yang perlu dirapikan). Revisi menarget ID+versi yang ditampilkan; bukan menimpa draft lain. Catatan pemilik opsional harus dipilih eksplisit. Semua contoh suara akun dan contoh tema masuk prompt sebagai JSON data, bukan instruksi. Simulation fixture mengikuti pilihan kata ganti `gue`/`aku` dan tema; bukan klaim kualitas Gemini live.

Tren hanya memakai URL HTTP(S), waktu sumber valid tidak di masa depan, dan alasan relevansi yang dikirim pemilik. Evidence yang disertakan selalu divalidasi, termasuk pada input format reguler dan kembali saat validasi output; bukan hanya ketika format input tren. Tidak ada pencarian web/grounding/discovery pada Fase 2. Sumber disalin dari input tervalidasi, bukan diambil dari output model. Output dengan field sumber tambahan ditolak. Tren selalu IN_REVIEW; revisi tren membatalkan jadwal aktif dan meminta review/jadwal baru sesuai policy Fase 1.

Bagian **Siapkan cadangan reguler** memungkinkan pemilik menyetujui draft reguler setelah ditinjau. Jika generasi gagal, request tetap FAILED (bukan tiga draft sukses). Tombol **Ambil draft reguler siap (cadangan)** benar-benar mengambil teks draft lama yang APPROVED, unlocked, tema aktif, bukan tren, dan tidak pernah memiliki jadwal. Eligibility diperiksa ulang saat diambil; fallback tidak mengubah konten/status atau menjadwalkan/publish otomatis. Persetujuan reguler dibatalkan menjadi DRAFT setelah perubahan substantif manual atau revisi AI (teks/tema/format/provenance); versi baru harus disetujui eksplisit sebelum eligible fallback lagi. Jadwal reguler tetap memakai policy replacement versi tersendiri, tidak dibatalkan diam-diam. Hasil cadangan bukan reservasi: operator masih perlu memeriksa saat menjadwalkan melalui policy jadwal yang ada.

## Konfigurasi server

Default aman tanpa key: `GENERATION_PROVIDER=simulation`, `GEMINI_ALLOW_OUTBOUND=false`. Adapter fixture deterministik berlabel SIMULASI. `DEMO_MODE=true` wajib untuk publikasi dan **tidak** memilih provider generasi.

Untuk operator yang sudah memberi izin terpisah menjalankan AI eksternal:

- Simpan key sendiri melalui secret/env server, **jangan chat**. `GEMINI_API_KEY` hanya dikirim Compose ke worker, bukan API/web/VITE bundle.
- Set `GENERATION_PROVIDER=gemini`, `GEMINI_ALLOW_OUTBOUND=true`, dan model eksplisit yang benar-benar tersedia pada akun serta mendukung `generateContent`/structured output.
- `GEMINI_MODEL` fallback bersama; override per fungsi `GEMINI_MODEL_IDEAS`, `_SHORT`, `_DEEP`, `_REVISE`, `_TRY_THEME`. Nilai kosong menggunakan fallback. Tidak ada model live default. Model disnapshot saat request diterima.
- Dokumentasi structured-output yang di-fetch langsung saat implementasi memberi contoh `gemini-4-hydrogen` (contoh Interactions API pada halaman yang berubah). **Itu contoh dokumentasi, bukan jaminan model tersedia/kompatibel generateContent pada akun ini.** Jangan menganggap daftar/model dari search atau dokumen lama sebagai bukti availability. Integrasi ini memakai REST generateContent yang masih didokumentasikan; uji live tertunda sampai operator memilih model/key dan memberi izin.
- Key/model/izin outbound yang tidak lengkap menghasilkan CONFIG dan kegagalan terlihat; **tidak** diam-diam dialihkan ke simulasi. Nama provider yang salah ditolak.
- `GENERATION_DAILY_LIMIT=20`: jumlah request baru yang diterima per kalender WIB, independen `dailyPostLimit`. Replay ID+input sama tidak menghitung ulang; input berbeda dengan ID sama ditolak. Failed requests tetap memakai kuota. Tidak meniru quota provider Google yang per project dan dapat reset pada Pacific time.
- `GEMINI_PRICING_JSON` opsional: JSON object per **exact actual model** (atau configured model jika API tidak memberi modelVersion), dengan `inputPerMillionUsd`, `outputPerMillionUsd`, angka finite nonnegative. Isi hanya harga yang diverifikasi operator. Tanpa harga/token lengkap atau provider simulation → SQL NULL. Tidak ada harga/biaya rekaan. Perkiraan bukan tagihan resmi; caching, tools, thinking tier/discount harus diperhitungkan operator sebelum mengisi harga yang sesuai.

Compose tetap empat service. Startup API menerapkan migrasi additive/idempotent 005 pada target stack saja. Jangan restart stack utama untuk QA; gunakan smoke terisolasi.

## Ketahanan dan batas bukti

`generation_requests` adalah durable outbox. Worker dispatcher merekonsiliasi request pending ke pg-boss `content.generate` dengan queue policy **exclusive**, singletonKey per request, retry terbatas per job. Advisory lock PostgreSQL per request melindungi dua worker; transaksi terminal menyimpan draft/result/attempt sukses atomik. Dispatcher tidak menahan row locks selama AI HTTP. Restart dari PROCESSING dapat mengulangi panggilan provider jika respons belum tersimpan; draft tetap idempoten. Percobaan lama ditandai UNKNOWN dan biaya/token yang hilang tetap null: **tidak mengklaim exactly-once panggilan atau penagihan AI**.

Revisi memeriksa unlocked, versi, status, tema/format dan provenance pada penerimaan; saat commit kembali memakai settings → draft → schedule locks serta versi/lock terbaru. Edit manual/lock-toggle selama AI berjalan menyebabkan CONFLICT tanpa menimpa pemilik. Saat commit, provenance personalSourceId/tema/format dan bukti tren dibandingkan lagi di bawah draft row lock terhadap snapshot request: penghapusan catatan pemilik lewat FK SET NULL (yang tidak menaikkan versi) juga menghasilkan CONFLICT, bukan menulis output berdasarkan sumber yang sudah hilang. Policy invalidasi jadwal, immutable execution snapshots Fase 1 tetap digunakan. Manual editor mengirim expectedVersion; backward-compatible API patch tanpa versi tetap diterima untuk klien Fase 1, tetapi revisi AI selalu wajib versi.

`generation_attempts` mencatat tiap percobaan provider/model, token jika tersedia, actual model, hasil/error aman dan biaya opsional. Response JSON divalidasi ketat jumlah, format, field dan panjang sebelum persist. HTTP resmi menggunakan header `x-goog-api-key`, bukan query URL. Timeout 45 detik, response non-STOP/JSON invalid/safety/429 terlihat dengan pesan tetap, tidak mencetak body provider atau rahasia. Tidak ada dependency/SDK baru; native fetch Node 24 dan Zod yang sudah dipin.

## Dokumentasi resmi yang benar-benar di-fetch/read

URL asli diakses langsung lewat Python urllib (web_extract backend tidak mendukung extract), bukan hanya snippet search:

- https://ai.google.dev/gemini-api/docs/structured-output — JSON Schema dan contoh terkini; halaman kini mencontohkan Interactions, bukan dasar asumsi model legacy.
- https://ai.google.dev/api/generate-content — POST `/v1beta/models/{model}:generateContent`, generationConfig `responseMimeType`/`responseJsonSchema`, candidates/content/parts/text, usageMetadata `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, modelVersion.
- https://ai.google.dev/gemini-api/docs/api-key — autentikasi API key dan header `x-goog-api-key`, server-only secrets.
- https://ai.google.dev/gemini-api/docs/rate-limits — RPM/TPM/RPD, project-level limits dan Pacific reset. Tidak hardcode kuota/tier Google.

Snapshot bacaan sementara `~/.hermes/cache/scratch/gemini-official-{0,1,2,3}.txt` bukan kontrak availability. Transport contract tests memakai Response fixture realistis, **bukan respons Gemini live**.

## Uji ulang

```
npm run lint
npm run typecheck
npm run test:all
npm run build
npm audit --audit-level=moderate
node scripts/phase2-smoke.mjs
```

Smoke membuat project unik dan port default **18086 / 15443**, tidak membaca `.env` utama, tidak menghapus volume; password QA acak hanya dipakai HTTP di harness. Jika port sudah dipakai, set `PHASE2_WEB_PORT` / `PHASE2_DB_PORT` ke port bebas. Evidence JSON/sesi browser fixture 0600 ditulis ke TMPDIR scratch. Stack ditinggalkan running untuk review; stop memakai `docker compose --env-file <path> -p <project> down`, **tanpa `-v`**. Sesi browser smoke bukan bukti input login melalui form.

Live Gemini **PENDING** karena key belum tersedia dan outbound belum diizinkan. Checkpoint runtime `6ea5314` sudah diverifikasi parent dan disetujui reviewer independen. Fase 2 belum COMPLETE karena uji Gemini nyata masih tertunda. Posting Meta/reply/grounding/gambar tetap di luar scope.
