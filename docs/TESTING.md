# Pengujian

```bash
npm ci
docker compose up -d --wait db
npm run lint
npm run typecheck
npm run test:all
npm run build
npm audit
```

Suite integrasi menggunakan PostgreSQL lokal (`127.0.0.1:5432` secara default). Jika memakai port/koneksi lain, set `TEST_DATABASE_URL` eksplisit. Suite membuat ulang database berakhiran `_test`; jangan arahkan ke database berisi data yang ingin dipertahankan.

## Smoke Docker terautentikasi

Setelah bootstrap admin dari README, jalankan `docker compose up -d --build --wait`. Untuk menjalankan smoke, masukkan kredensial fixture di terminal lokal (Bash) tanpa menuliskan password ke command history:

```bash
read -r -p 'Username admin test: ' SMOKE_ADMIN_USERNAME
read -r -s -p 'Password admin test: ' SMOKE_ADMIN_PASSWORD; printf '\n'
SMOKE_ADMIN_USERNAME="$SMOKE_ADMIN_USERNAME" SMOKE_ADMIN_PASSWORD="$SMOKE_ADMIN_PASSWORD" npm run smoke
unset SMOKE_ADMIN_USERNAME SMOKE_ADMIN_PASSWORD
```

Smoke login melalui Nginx, menyimpan cookie sesi in-memory, mengirim CSRF, lalu membuktikan alur `QUEUED → COMPLETED` beserta payload observasi dan ID aksi di riwayat. Gunakan `SMOKE_BASE_URL` bila port berbeda.

## Checklist UI dan persistensi

1. Buka dashboard di `http://127.0.0.1:8080`. Login, periksa label simulasi, empat tema preset, dan format 70/20/10.
2. Buat/edit tema dan seimbangkan bobot; ubah porsi format, contoh tulisan, catatan pemilik, topik review, dan batas harian.
3. Buat/edit/kunci draft. Masukkan sumber/waktu/kaitan untuk draft tren, lalu setujui melalui review.
4. Jadwalkan, ubah jadwal, batalkan satu entri, dan biarkan satu eksekusi simulasi selesai. Filter riwayat dan pastikan status integrasi tidak terhubung.
5. Jalankan `docker compose down` **tanpa `-v`**, kemudian `docker compose up -d --wait`; verifikasi draft dan riwayat lama tetap ada. Logout, pastikan rute editorial tidak terbuka.
