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

# Fase 1 — Pemulihan sesi THREAD AUTOMATION (2026-11-21 WIB)

- Histori sesi direkonsiliasi dengan `git status --short --branch`, `git log`, file state, dan spesifikasi asli. HEAD `5b42283`, backend Fase 1 parsial belum dicommit. Implementasi history/integrations sudah ada dan tes yang diwarisi sebenarnya lulus; build belum lulus. Web masih dashboard Fase 0 pada awal pemeriksaan.
- Baseline `npm run test:all`: 11 unit + 41 integrasi green. `npm run build` RED dengan enam error TS2379 karena Zod optional mengizinkan `undefined` tetapi kontrak repo memakai `exactOptionalPropertyTypes`. Samakan tipe parameter yang memang memperlakukan undefined sebagai absen; `npm run build && npm run typecheck` exit 0.
- RED: `npm run test:integration -- -t 'editor bobot menolak'` exit 1; PUT yang hanya menyertakan satu tema mengembalikan 200. Perbaikan mewajibkan tepat satu ID untuk setiap tema; `npm run test:all` exit 0 (14 unit/behavior + 42 integrasi, 0 gagal/skip). `npm run lint` exit 0, `npm audit --audit-level=moderate` exit 0 (0 kerentanan).
- Bootstrap interaktif menyimpan hanya hash Argon2id ke `.env` (0600); Compose mengirim env admin hanya ke API. Worker menunggu migrasi/seed API. Uji fresh Compose awal menemukan `ECONNREFUSED` karena socket PostgreSQL sementara lolos healthcheck. Probe sekarang memakai TCP `pg_isready -h 127.0.0.1`. Uji berikut sempat gagal pada koneksi HTTP harness; koneksi eksplisit close dan startup settling dipakai di fixture final.
- E2E `node ~/.hermes/cache/scratch/threads-phase1-smoke.mjs` exit 0, project terisolasi `threads-phase1-qa-f376ef92`; empat service healthy. `node scripts/smoke.mjs` di dalam fixture memverifikasi hasil editorial dan logout, aksi `9f04305f-989f-4444-85a2-ebfe3a927f6a`. E2E memverifikasi proteksi 401/403, preset/bobot/porsi, suara/sumber/topik, draft edit+lock/423, bukti tren dan approve, reschedule/cancel, filter dan status integrasi. Review dan data ditelusuri: draft `5945f071-4be3-41f7-81a8-946861f272b0`, tren `551f1e8c-aea9-47b5-84e4-fa5f1abac362`, jadwal `837ed233-a385-4a36-8c57-bcf40bf12e67` sukses versi 2 dengan versi 1 `SKIPPED_STALE`, jadwal batal `b99b7d9e-fd9e-4659-b9d6-ef03c0220e0a`, execution `605de6ac-6c8b-4d03-8c08-d33d07cdbbaf` payload teks tersimpan, `sim-*`, `publishedUrl=null`.
- Setelah `docker compose down` tanpa `-v` dan `up -d --wait`, aksi `90be1c3f-eb1d-4c04-9ad7-b0d99b960eda`, sesi, draft, suara, dan hasil simulasi bertahan. Logout mencabut sesi. Stack QA dihentikan tanpa menghapus volume atau menyentuh volume utama. Tidak ada panggilan Meta/Gemini.
- Sisa: menerima frontend `apps/web` dari delegasi, review UX dan diff, verifikasi browser dan quality gates final, tulis bukti, baru commit. Belum mulai Fase 2; tidak push.

## Fase 1 — Dashboard diterima dan QA mandiri

- Delegasi frontend selesai; parent menjalankan `git diff --check && npm run lint && npm run typecheck && npm run test:all && npm run build`, exit 0. Hasil: 15 unit/behavior (4 file) + 42 integrasi PostgreSQL (7 file), 0 gagal/skip; kelima workspace dibangun.
- Rebuild `threads-phase1-qa2` di port 18082 memakai volume QA sebelumnya, bukan volume utama; seluruh service healthy. Pengujian browser memakai sesi fixture yang dibuat langsung di `admin_sessions` QA dan cookie HttpOnly; **bukan pengujian input login lewat form**. Login/password/expiry/CSRF sudah diuji melalui suite integrasi dan smoke HTTP. Vault tidak memiliki login tersimpan. Admin utama tidak diubah.
- Browser membuktikan: buat tema `Rutinitas UI QA` lalu edit nama ke `Rutinitas UI QA revisi`; tambah contoh suara, catatan pemilik, dan topik review; draft `814ce7c7-59d9-429c-85e4-f6a31432e922` dibuat/edit/kunci (Edit disabled); jadwal 24 Nov 10:00 WIB diubah ke 11:00 WIB dan versi 2, kemudian dibatalkan menjadi versi 3; filter riwayat CANCELLED menampilkan hasil; draft tren dengan URL/waktu/relevansi masuk review lalu disetujui; integrasi menunjukkan belum terhubung, tidak ada akses live; simulasi tombol menjadi Selesai (ID prefix `7fb1923e`); logout kembali ke form login. Tidak ada error JS yang tertangkap pada alur yang diperiksa.
- Batas harness: modal native `window.confirm` membuat Runtime.evaluate timeout, sementara handleJavaScriptDialog tidak menemukan dialog pada target default. Pembatalan akhirnya diuji dengan override `window.confirm=()=>true` pada tab QA; kontrol aplikasi/API dijalankan normal, tetapi interaksi dialog native sendiri belum tervalidasi. Input datetime menggunakan setter native React karena helper fill tidak mengisi tipe tersebut.
- Screenshot integrasi ditinjau visual: layout desktop tidak overlap; catatan minor adalah teks sekunder kecil dan dot hijau pada integrasi belum terhubung. Login form terlihat setelah logout. Review independen kode sedang berjalan; belum ada commit/mark COMPLETE.

## Fase 1 — Tiga blocker correctness (delegasi, tetap IN PROGRESS)

### Scope dan baseline

- Membaca seluruh spesifikasi asli `/home/deva/.hermes/composer-pastes/pasted_content_2026-11-21_02-15-53-457_b79dcc.txt`, state files, Git, repository aktual, dan skill TDD/debugging/continuity. HEAD tetap `5b42283`; semua dirty work warisan dipertahankan. Tidak commit/push, tidak menandai Fase 1 COMPLETE, tidak menyentuh kredensial/admin utama, tidak memanggil Meta/Gemini.
- Baseline aktual `npm test && npm run test:integration` exit 0: **15 unit (4 file) + 42 integrasi PostgreSQL (7 file)**. Reset destruktif helper dibatasi database berakhiran `_test`; database aplikasi utama tidak di-reset.
- Akar masalah: mutasi draft tren tidak menginvalidasi jadwal; completion hanya memeriksa jadwal, bukan eligibility/pause terbaru; reservasi dan completion memakai count-before-write tanpa mutex bersama; history membaca join ke draft/tema/jadwal terkini sehingga mengubah masa lalu.

### RED → GREEN vertikal

1. `npm run test:integration -- -t 'edit tren terjadwal|completion atomik'`: RED **2 gagal**, tepat karena jadwal masih SCHEDULED dan hasil lama masih SIMULATED_OK setelah draft masuk review. GREEN **2 lulus** setelah invalidasi/outbox CANCEL atomik serta recheck eligibility + pause di completion. Full interim **15 unit + 44 integrasi lulus**.
2. `npm run test:integration -- -t 'reservasi harian konkuren'`: RED **2 gagal**, kedua create/reschedule independen berhasil pada limit 1. Test memakai dua draft/jadwal berbeda dan trigger PostgreSQL test-only `pg_sleep(0.15)` untuk membuka jendela count-before-write, dengan cleanup `finally`. GREEN **2 lulus** setelah mutex row `editorial_settings(id=1)` diambil sebelum domain locks. Satu akun Phase 1 sengaja memakai mutex sederhana ini, bukan infrastruktur lock baru per hari. Update settings memakai row UPDATE yang sama, sehingga lowering limit terserialisasi.
3. `npm run test:integration -- -t 'completion konkuren'`: RED **1 gagal**, dua job independen SIMULATED_OK walau adapter barrier menurunkan limit dari 2 ke 1 sesudah kedua preflight. GREEN **1 lulus** setelah hitungan sukses dan insert hasil dilakukan atomik di bawah mutex/settings terbaru; satu sukses dan satu SKIPPED_LIMIT. Full interim **15 unit + 47 integrasi lulus**.
4. `npm run test:integration -- -t 'riwayat sukses immutable|riwayat stale menyimpan'`: RED **2 gagal**, teks/format/tema hasil sukses berubah dan filter waktu versi stale hilang. GREEN **2 lulus** setelah snapshot JSONB per `(schedule_id, version)` dan snapshot eksekusi; semua filter history membaca snapshot, tanpa join ke current draft/theme/schedule. Full interim **15 unit + 49 integrasi lulus**.
5. `npm run test:integration -- -t 'edit reguler terjadwal'`: RED **1 gagal**, adapter yang sudah membaca teks lama masih bisa complete setelah edit reguler. GREEN **1 lulus** setelah edit reguler menaikkan versi semua jadwal aktif dan menulis UPSERT dalam transaksi sama; snapshot versi pengganti memuat teks/tema/format baru. Edit tren membatalkan jadwal aktif dan memerlukan persetujuan **serta jadwal baru**; approve tidak menghidupkan jadwal lama diam-diam.
6. `npm test -- apps/web/src/history.test.ts`: RED **2 gagal**, metadata legacy kosong tanpa penjelasan dan tanpa label snapshot. GREEN **2 lulus**: UI memakai field snapshot, mendukung null historis, menampilkan `Metadata historis tidak lengkap`, placeholder yang jujur, dan label `Snapshot eksekusi`. Pilihan tema menyebut bahwa nama pilihan adalah nama kini; hasil/filter atribusi tetap ID snapshot historis.
7. `npm run test:integration -- -t 'migrasi merekonsiliasi'`: RED **1 gagal**, jadwal legacy IN_REVIEW tetap aktif. GREEN setelah migrasi 004 membatalkan versi aktif yang tidak eligible + outbox/history secara idempoten. Test juga memanggil completion langsung pada fixture legacy untuk membuktikan guard atomik tidak bergantung hanya pada invalidasi edit.
8. Test backfill tambahan meniru schema lama dengan trigger snapshot dilepas hanya pada database `_test`: bukti result dan waktu outbox dipakai; tema ID/status/format/teks/waktu yang tidak diketahui tetap null, bukan diisi dari draft kini. Apply migration berulang sesudah edit tidak mengubah history. `npm run test:integration -- -t 'migrasi merekonsiliasi|backfill legacy'` **2 lulus**.
9. Assertion status draft pada history sukses dibuat RED (`npm run test:integration -- -t 'riwayat memuat payload'`: **1 gagal**, status DRAFT dari saat reservasi). Trigger eksekusi kini menangkap status event-time untuk versi yang cocok, bukan status reservasi; full suite berikut GREEN.

### Keputusan implementasi

- Urutan runtime lock konsisten: **settings → draft → schedule**; settings UPDATE sendiri hanya mengambil lock settings. Mutex yang sama melindungi create, reschedule, cancel, edit/review/cancel draft, dan completion. Tidak menahan lock selama adapter simulasi; hasil adapter tidak dipercaya sebagai otorisasi, completion selalu revalidasi.
- Completion mengembalikan outcome eksplisit agar penolakan atomik kuota/pause tidak disalahlabeli sukses. Hasil existing per versi tidak dapat dipromosikan menjadi COMPLETED tanpa execution sukses baru; penjadwalan ulang adalah jalan membuat versi baru.
- Migrasi additive/idempoten `003_history_snapshots.sql`: tabel `schedule_versions`, kolom `schedule_executions.snapshot`, trigger capture, backfill berbasis bukti. Provenance `CAPTURED` untuk data baru, `LEGACY_PARTIAL` untuk history lama, `LEGACY_CURRENT_STATE` untuk current version yang hanya dapat dipotret pada saat upgrade. Tidak ada klaim bahwa snapshot upgrade adalah metadata eksekusi masa lalu.
- Migrasi `004_review_schedule_reconciliation.sql`: perbaikan jadwal legacy yang belum eligible di bawah mutex settings; idempotency diuji dengan apply berulang. Tidak menghapus draft/jadwal/eksekusi lama.

### Verifikasi akhir aktual

- `git diff --check && npm run lint && npm run typecheck && npm run test:all && npm run build` **exit 0**: **17 unit/behavior (5 file) + 52 integrasi PostgreSQL (7 file), 0 gagal/skip**; build seluruh lima workspace PASS.
- Final stability check: `git diff --check` PASS; regresi PostgreSQL kritis `reservasi harian konkuren|completion konkuren|edit tren terjadwal|completion atomik|edit reguler terjadwal` diulang **3 kali**, masing-masing **6 lulus**, tanpa kegagalan. Targeted run sengaja melewati test di luar filter.
- Satu quality-gate awal menemukan TS6059 dari import source lintas rootDir di test migrasi; diperbaiki memakai export package yang sudah ada `@threads-id/db/migrate`, lalu seluruh command di atas diulang sampai exit 0.
- `node /home/deva/.hermes/cache/scratch/threads-phase1-smoke.mjs` **exit 0** pada project Docker baru **`threads-phase1-qa-99dc21af`**, port web **18083** dan DB **15440**. Empat service healthy; HTTP auth/CSRF/editorial/draft-lock/review/reschedule/cancel/history/worker simulasi lulus. Ini fixture terpisah, bukan admin utama atau stack QA browser `threads-phase1-qa2`.
- Smoke bawaan: aksi `8eeef161-12b0-471a-a29f-6574acd14513` COMPLETED. Alur jadwal: draft `e91ad5f8-c1df-438a-b1ca-4fce61749f8c`, jadwal `7c2be63a-5acd-46dd-9ff7-a7348c24ec47` versi 2, execution `337196ca-1474-4563-8c9a-2b6db9ec5742`, teks result sesuai, simulated=true, publishedUrl=null, ID sim-*; versi 1 stale dan cancellation tercatat.
- Fresh boot dan restart dengan volume sama PASS; sesi, demo action `33b28e70-88d9-4e8f-808e-4751ace9d81b`, draft, gaya dan execution ID tetap ada setelah restart. Fixture dihentikan tanpa `-v`; volume dipertahankan. Stack utama DB 5432 dan stack browser QA 18082/15439 tetap healthy, tidak diubah.
- Docker install mencetak warning deprecation ESLint/install-scripts esbuild; build tetap sukses dan npm ci melaporkan 0 vulnerabilities. Tidak mengubah dependensi di luar scope untuk warning tersebut.

### File yang diubah oleh delegasi blocker ini saja

- `packages/db/src/drafts.ts`
- `packages/db/src/schedule.ts`
- `packages/db/migrations/003_history_snapshots.sql` (baru)
- `packages/db/migrations/004_review_schedule_reconciliation.sql` (baru)
- `apps/worker/src/schedule-processor.ts`
- `apps/worker/src/schedule.integration.test.ts`
- `apps/api/src/history.integration.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/history.test.ts` (baru)
- `WORKLOG.md`

### Next exact action / batas handoff

- Parent harus inspeksi mandiri diff blocker dan, bila diperlukan, rebuild stack QA browser untuk melihat bundle baru; stack `threads-phase1-qa2` yang dibiarkan running masih image QA sebelumnya. Perubahan UI snapshot sudah diuji render React nyata (SSR), **bukan walkthrough browser baru** pada delegasi ini.
- Status keseluruhan Fase 1 tetap **IN PROGRESS**. Jangan commit/push atau mulai Fase 2/3; batas QA form login/dialog native dari pemeriksaan sebelumnya tetap bukan klaim sudah lulus.

## Verifikasi parent setelah perbaikan blocker

- Parent menjalankan `git diff --check && npm run lint && npm run typecheck && npm run test:all && npm run build && npm audit --audit-level=moderate`, exit 0: 17 unit/behavior + 52 integrasi PostgreSQL, 0 gagal/skip; audit 0 kerentanan.
- Parent menjalankan ulang `node ~/.hermes/cache/scratch/threads-phase1-smoke.mjs` pada kode terbaru, exit 0. Log lengkap: `~/.hermes/cache/scratch/threads-phase1-final-smoke.log`.
{"ok":true,"actionId":"2a0ddf9c-0b4f-4c78-b2f0-e8e435e2f3de","status":"COMPLETED","historyCount":2}
{"firstRun":"PASS","actionId":"5bbfe1ae-f7b0-429c-96c9-a2d9f6b5db1a","draftId":"dc5bd9dd-b73b-4e99-b36e-502b04976012","trendId":"6c91b233-36fc-4352-8743-b71c05516cd8","scheduleId":"49ef08a3-0c85-4e0b-80b5-60b6741136d4","cancelledScheduleId":"85710247-eddb-4053-b8ef-a942e09f0f89","simulatedExecutionId":"1a3e7e6f-ea21-4a37-abd8-4986a3eb818a"}
PASS: restart tanpa hapus volume; sesi, aksi demo, draft, gaya, dan hasil simulasi bertahan; logout mencabut sesi.
- QA image `threads-phase1-qa2` direbuild, migrasi pada volume lama berhasil, sesi fixture baru dipakai (bukan input password form). Browser memperlihatkan metadata lama dengan label ketidaklengkapan yang jujur. Draft baru `Snapshot UI final: niat tidur cepat malah cek chat.` dijadwalkan dan sukses simulasi. Sesudah teks draft diedit menjadi `Snapshot UI final SUDAH DIEDIT sesudah eksekusi.`, riwayat masih menampilkan teks asli dan `Snapshot eksekusi`. Bukti `docs/qa/phase1-history-snapshot.png`. Tidak ada horizontal overflow pada viewport awal QA.
- Review independen ulang sudah diminta; checkpoint menunggu verdict. Tidak commit/push sebelum review selesai.

## Penutupan checkpoint Fase 1

- Reviewer ulang menyetujui tiga perbaikan dan jalur regresinya untuk simulasi lokal; tidak ada blocker tersisa pada cakupan itu. Approval bukan jaminan exactly-once publikasi live.
- Commit runtime: `7bea826` — `Phase 1: dashboard editorial dan kontrol admin`; tidak push.
- Implementasi simulasi lokal telah diverifikasi otomatis, HTTP E2E/persistensi, dan browser fixture yang dijelaskan di atas; fase belum ditandai COMPLETE karena QA manual masih tersisa. Batas input password browser dan modal native bukan diklaim PASS; keduanya disisakan untuk validasi manual operator. Main `.env` belum punya admin; gunakan README untuk bootstrap.
- Dokumentasi disinkronkan dalam commit terpisah. Fase 2 tidak dimulai tanpa izin. QA stack pada 18082 dipertahankan untuk pemeriksaan; DB utama/data tidak dihapus.
