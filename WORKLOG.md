# WORKLOG — Phase 0

## Tujuan

Membangun fondasi lengkap Threads Automation Indonesia sebagai demo lokal: dashboard → Fastify API → PostgreSQL/pg-boss → worker idempoten → status/riwayat, tanpa Meta/Gemini/kredensial eksternal, lalu memverifikasi quality gates, E2E Docker, dan persistence setelah restart.

## Waktu

- Tanggal: 2026-11-21
- Zona kerja: WIB (`UTC+07:00`)
- Mulai implementasi teramati sekitar 09:19 WIB; verifikasi final dimulai 09:30 WIB.

## Kronologi dan bukti

### 1. Inspeksi awal

- `pwd && git status --short --branch ... && node --version && npm --version && docker --version && docker compose version`
- Exit `0`: repo kosong di `main`; Node host `v26.13.1`, npm `12.2.3`, Docker `29.10.0`, Compose `v2.29.1` tersedia.
- Keputusan: container memakai Node 24 dan PostgreSQL 17 sesuai spesifikasi; host hanya untuk tooling.

### 2. Kontrak — RED → GREEN

- Dibuat lebih dahulu: `packages/contracts/src/index.test.ts`.
- RED: `npm test -- --run packages/contracts/src/index.test.ts` → exit `1`; suite gagal karena `./index.js` belum ada. Ini kegagalan yang diharapkan.
- Implementasi: schema Zod untuk UUID aksi, kind literal sintetis, status, flag `demo=true`, dan nama job.
- GREEN: perintah yang sama → exit `0`; `1` file dan `1` test passed.

### 3. API dan worker — RED → GREEN

- Dibuat lebih dahulu: `apps/api/src/app.test.ts` dan `apps/worker/src/processor.test.ts`.
- RED: `npm test -- --run apps/api/src/app.test.ts apps/worker/src/processor.test.ts` → exit `1`; dua suite gagal karena `app.js` dan `processor.js` belum ada. Kegagalan sesuai fitur yang belum diimplementasikan.
- Implementasi: Fastify app dengan dependency injection, repository PostgreSQL, migrasi, pg-boss enqueue, worker atomic claim, completion dan failure handling.
- GREEN: setelah build contracts, perintah test yang sama → exit `0`; `2` files dan `3` tests passed.

### 4. Web, Compose, dan dokumentasi

- Dashboard React/Vite Indonesia dibuat dengan label `DEMO / LOKAL SAJA`, polling 1,5 detik, tombol simulasi, history, dan formatter `Asia/Jakarta`.
- Nginx mem-proxy `/api` dan `/health` secara same-origin.
- `compose.yaml` dibuat dengan tepat empat service: `db`, `api`, `worker`, `web`; volume `postgres_data`; healthcheck tiap service.
- API menjalankan migrasi idempoten saat startup; perintah manual `npm run migrate` tetap tersedia.
- Dibuat README, docs arsitektur/roadmap/testing, state files, changelog, dan worklog ini.

### 5. Masalah yang ditemukan dan solusi

1. Lint awal gagal: `vite.config.ts` tidak masuk tsconfig dan global Node di smoke script tidak dikenal. Solusi: masukkan config ke `include` dan tambahkan global khusus `.mjs` di ESLint.
2. Typecheck gagal: pg-boss v12 memakai named export `PgBoss`, dan dist package DB belum tersedia saat app typecheck. Solusi: named import dan build package contracts/db sebelum typecheck app.
3. Vite terpasang ganda (`7.2.4` workspace vs `7.3.8` root), menyebabkan tipe plugin tidak kompatibel. Solusi: sejajarkan Vite ke `7.3.8`.
4. Docker startup pertama: API/worker sempat `ECONNREFUSED` walaupun DB baru berstatus healthy. Solusi: tambahkan `restart: on-failure:5` untuk menangani race startup tanpa service tambahan.
5. Healthcheck web gagal karena `localhost` dipilih sebagai IPv6 sementara Nginx listen IPv4. Solusi: gunakan `127.0.0.1`.
6. Audit awal menemukan advisory pada versi Fastify/Zod/dev tooling yang dipin. Solusi: perbarui Fastify `5.12.8`, Zod `4.6.7`, Vitest `4.1.12`, dan typescript-eslint `8.73.0`; audit final bersih.
7. Commit pertama gagal exit `128` karena repo kosong belum memiliki identitas Git. Solusi: set identitas **lokal repo saja** ke `Hermes Agent <hermes-agent@local>`; tidak mengubah konfigurasi global atau kredensial user.

### 6. Verifikasi final aktual

Perintah: `npm run lint && npm run typecheck && npm test && npm run build && npm audit`

- Exit `0`.
- Lint: PASS, zero warnings.
- Typecheck: PASS untuk contracts, db, api, worker, web.
- Tests: Vitest `4.1.12`; `3` test files passed, `4` tests passed.
- Build: semua workspace PASS; web menghasilkan bundle production (JS 195.82 kB, gzip 62.41 kB).
- Audit: `found 0 vulnerabilities`.

Perintah: `docker compose up -d --build --wait && npm run smoke`

- Exit `0`.
- Keempat service healthy.
- Smoke setelah binding lokal final: `actionId=7c7778b6-ef42-46fd-9e41-fa6331645cc0`, status `COMPLETED`, `historyCount=3`; `docker compose config --services` menampilkan tepat `db`, `api`, `worker`, `web`.
- Alur yang benar-benar divalidasi: Nginx `/health` → POST create → UUID/DB/queue → worker → GET status → history.

Perintah restart persistence: `docker compose down` (tanpa `-v`) → `docker compose up -d --wait` → GET aksi dan history.

- Exit `0`.
- Bukti: `{"persisted":true,"actionId":"8d46466c-9baf-4238-b79b-3b2df59810cd","status":"COMPLETED","historyCount":2}`.
- `docker compose ps`: web/api/worker/db seluruhnya `healthy`.

## File dibuat/diubah

- Root: package/config/lock, Dockerfile, Compose, env example, README, smoke script, state dan log docs.
- `apps/web`: React dashboard, styling, Vite config, Nginx config.
- `apps/api`: Fastify app/server dan tests.
- `apps/worker`: pg-boss runtime, processor dan test.
- `packages/contracts`: Zod contracts dan test.
- `packages/db`: migration, pool/repository, migration runner.
- `docs`: architecture, roadmap, testing.

## Kriteria selesai

- [x] Satu npm-workspaces monorepo.
- [x] Web/API/worker/contracts/db sesuai peran.
- [x] Tepat empat Compose services dan volume PostgreSQL persisten.
- [x] Migrasi dan healthchecks.
- [x] Alur vertikal nyata dan traceable.
- [x] UUID unik dan worker idempoten/atomic.
- [x] Gate dan label DEMO; tanpa Meta/Gemini/kredensial.
- [x] Port web hanya dibind ke `127.0.0.1`.
- [x] UTC storage + Asia/Jakarta display.
- [x] Lint/typecheck/test/build/audit PASS.
- [x] Docker E2E PASS.
- [x] Restart persistence PASS pada volume yang sama.
- [x] Dokumentasi dan continuity files tersinkron.

## Tertunda

Tidak ada item Phase 0 yang tertunda. Auth/otorisasi sengaja ditunda ke Phase 1 dan merupakan syarat sebelum penggunaan non-lokal.

## Next exact action

Jangan menambah integrasi eksternal. Tunggu spesifikasi otoritatif Phase 1, lalu mulai dari test perilaku auth yang gagal sebelum implementasi.

## Verifikasi independen dan koreksi setelah handoff

### 7. Audit ulang oleh agent induk

- Repo diverifikasi dari commit awal Phase 0 `6150620`; working tree saat itu bersih dan empat container berstatus `healthy`.
- Quality gates dijalankan ulang: `npm run lint && npm run typecheck && npm test && npm run build && npm audit` → exit `0`; tetap `3` file / `4` test passed dan audit `0` vulnerability.
- Smoke independen menghasilkan aksi `c8f0dd9a-b201-4cb9-9c62-005fa7cf2d7e` dengan status `COMPLETED`.
- Stack dibuat ulang dengan `docker compose down`, `docker compose create`, dan `docker compose start` tanpa menghapus volume. Aksi tersebut tetap tersedia dan history berjumlah `4`; seluruh service kembali `healthy`.
- Dashboard dibuka di browser nyata pada `http://127.0.0.1:8080`. Klik tombol menaikkan riwayat dari `4` ke `5` aksi dan aksi baru selesai melalui jalur UI → API → pg-boss → worker → PostgreSQL → UI.

### 8. Gap spesifikasi yang ditemukan

- Audit kode menemukan payload job awal hanya berisi `actionId`, sedangkan spesifikasi meminta payload sintetis yang benar-benar bertema keseharian usia 20-an.
- Implementasi awal memakai istilah “usia 20 detik”, sehingga status Phase 0 ditahan sementara sampai gap diperbaiki.

### 9. Koreksi dengan RED → GREEN

- Test kontrak, API, dan worker diperbarui lebih dahulu untuk mewajibkan sample editorial `KEBIASAAN_DIGITAL` / `OBSERVASI_PENDEK` dengan teks observasi “cek jam”.
- RED: test terarah → exit `1`; `3` test gagal karena kontrak/sample/job/result belum tersedia. Ini kegagalan yang diharapkan.
- Implementasi: tambah schema dan tipe payload job, sample editorial tervalidasi, pengiriman sample dari API, validasi job di worker, result editorial di PostgreSQL, serta copy dashboard yang sesuai usia 20-an.
- GREEN awal mengungkap package `contracts` masih memakai output build lama. Script `npm test` diperbaiki agar membangun package shared sebelum Vitest; typecheck kemudian menemukan tipe queue lama dan diperbaiki menjadi `DemoJobData`.
- Smoke lama sengaja gagal karena masih memeriksa `simulatedAgeSeconds`; assertion diperbarui untuk memeriksa pillar, format, dan teks editorial nyata.

### 10. Verifikasi final setelah koreksi

- `npm run lint && npm run typecheck && npm test && npm run build && npm audit && npm run smoke` → exit `0`.
- Tests: `3` file / `4` test passed. Build semua workspace PASS. Audit: `0 vulnerabilities`.
- Docker images dibangun ulang dan empat service kembali `healthy`.
- Smoke final: aksi `206dcdb4-e376-4377-b415-266e9f6ab7a4`, status `COMPLETED`, `historyCount=7`.
- Bukti result menyimpan `editorialSample` dengan pillar `KEBIASAAN_DIGITAL`, format `OBSERVASI_PENDEK`, dan teks observasional keseharian usia 20-an.
- Browser final menampilkan heading “Simulasi konten keseharian usia 20-an” dan hasil terbaru “Simulasi konten observasi kebiasaan digital berhasil diproses.”
- Commit koreksi terverifikasi: `d7a1310 fix: gunakan payload editorial usia 20-an pada simulasi`.
