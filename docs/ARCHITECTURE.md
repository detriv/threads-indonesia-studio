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

Tidak ada autentikasi, integrasi Meta, Gemini, token eksternal, penjadwalan publik, atau aksi nyata. Deployment internet tidak didukung sampai Phase 1 auth selesai.
