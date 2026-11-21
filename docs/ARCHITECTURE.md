# Arsitektur Phase 0

## Alur vertikal

1. Browser memanggil `POST /api/demo/actions` melalui origin web yang sama.
2. API membuat UUID unik dan menyimpan baris `QUEUED` dengan `demo=true` serta jenis tetap `SYNTHETIC_AGE_20S`.
3. API mengirim job `demo.synthetic-age-20s` ke `pg-boss`, memakai action ID sebagai singleton key.
4. Worker menerima job dan melakukan `UPDATE ... WHERE status='QUEUED' RETURNING id`; hanya worker yang berhasil mengklaim boleh memproses.
5. Worker menyimpan hasil sintetis (`simulatedAgeSeconds: 20`) dan status `COMPLETED`.
6. Dashboard polling setiap 1,5 detik dan menampilkan status/riwayat dalam zona Asia/Jakarta.

## Keputusan

- **PostgreSQL 17 + pg-boss:** satu penyimpanan persisten untuk state aplikasi dan antrean; tidak menambah Redis/service kelima.
- **Migrasi saat API startup:** memenuhi batas empat service Compose dan tetap menyediakan perintah manual.
- **Idempotensi berbasis state transition:** klaim atomik mencegah penyelesaian ganda saat job dikirim ulang.
- **Kontrak bersama Zod:** status, jenis aksi, payload, dan nama job tidak diduplikasi antar aplikasi.
- **UTC di database:** `timestamptz` dan container `TZ=UTC`; konversi tampilan dilakukan oleh browser dengan `Asia/Jakarta`.
- **Same-origin API:** Nginx mem-proxy `/api` dan `/health` ke Fastify; browser tidak memerlukan CORS.
- **Gate DEMO:** hanya aksi sintetis literal yang diterima kontrak; API/worker berhenti saat `DEMO_MODE != true`.

## Model data

`demo_actions`: UUID, kind, status, flag demo, result JSONB, error, created/updated/completed timestamp. Check constraints menolak kind, status, dan flag non-demo di tingkat database.

## Batas Phase 0

Pada checkpoint Fase 0, dashboard hanya demo lokal tanpa autentikasi.

## Fase 1 — Dashboard editorial

- Akses lokal: satu admin di-bootstrap dengan hash Argon2id; sesi opaque disimpan dengan hash SHA-256 di PostgreSQL, cookie sesi `HttpOnly`/`SameSite=Lax`, header CSRF untuk mutasi, dan rate limit login in-memory. Bukan konfigurasi deploy publik.
- Tema, contoh suara, catatan pengalaman pemilik, topik review, pengaturan format dan batas harian, draft, dan jadwal tersimpan di PostgreSQL. Draft tren memerlukan sumber/waktu/relevansi dan review. Status draft terpisah dari eksekusi.
- Mutasi jadwal dan outbox berada dalam transaksi yang sama. Dispatcher mengirim ID + versi jadwal ke pg-boss; worker mengecek status, versi, jeda, dan batas. Hanya satu penyelesaian lokal dapat tersimpan untuk satu versi jadwal.
- Adapter lokal menghasilkan `sim-*` dan `publishedUrl: null`. Fase 1 tidak mengirim post, reply, atau request ke Meta/Gemini. Worker menunggu health API (migrasi dan seed selesai); health PostgreSQL memerlukan listener TCP, bukan socket sementara dari proses init image.
