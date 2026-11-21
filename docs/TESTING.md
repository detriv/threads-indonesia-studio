# Pengujian

## Quality gates lokal

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

Unit/behavior tests meliputi kontrak yang menolak aksi non-demo, API yang membuat ID traceable dan mengantrekan job, health/history, serta worker yang menyelesaikan aksi hanya sekali.

## E2E Docker

```bash
docker compose up -d --build --wait
npm run smoke
```

Smoke melakukan health check melalui Nginx, membuat aksi melalui same-origin API, polling sampai `COMPLETED`, memverifikasi hasil usia sintetis 20 detik, dan memastikan ID ada di history.

## Restart persistence

1. Catat `actionId` hasil smoke.
2. Jalankan `docker compose down` (tanpa `-v`).
3. Jalankan `docker compose up -d --wait`.
4. Ambil `/api/demo/actions/:id` dan `/api/demo/actions` melalui `http://localhost:8080`.
5. Lulus bila aksi lama tetap `COMPLETED` dan tetap ada di history.

Jangan gunakan `docker compose down -v` dalam tes persistence karena opsi itu sengaja menghapus volume.

## Pemeriksaan manual UI

Buka `http://localhost:8080`, pastikan label **DEMO / LOKAL SAJA** terlihat, klik **Jalankan simulasi**, lalu lihat status bergerak ke selesai dan timestamp tampil dalam format Indonesia/Asia Jakarta.
