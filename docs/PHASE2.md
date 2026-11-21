# Fase 2 — Konten Gemini (IMPLEMENTED, live verification pending)

Fase 1 tetap COMPLETE (`7bea826`). Fase 3 belum dimulai. Tidak ada publikasi/reply Meta live. `.env`/admin/volume utama tidak diubah oleh implementasi ini.

## Klarifikasi transport teks — checkpoint terbaru (belum commit)

Gemini di aplikasi menerima prompt/chat dan mengembalikan **teks draft/caption**, bukan membuat post Threads. Endpoint tetap REST `generateContent`, bukan browser scraping atau Interactions. HTTP request/envelope Gemini tetap JSON seperti protokol resminya; `generationConfig.responseMimeType=text/plain`, tanpa `responseJsonSchema`/`responseSchema`, dan isi `parts.text` tidak di-JSON.parse. Tidak ada SDK/service baru.

- IDEAS/SHORT/DEEP/REVISE: satu teks biasa, newline/paragraf dipertahankan, trim batas luar, 1–500 karakter. Format ditetapkan aplikasi dari purpose/input; sumber/provenance/status tetap dari input tervalidasi/repository, bukan metadata model.
- TRY_THEME: **satu provider call per attempt** menghasilkan satu respons teks dengan tepat3bagian berurutan pada delimiter baris sendiri: `<<<DRAFT_1_OBSERVASI_PENDEK>>>` … `<<<END_DRAFT_1>>>`, `<<<DRAFT_2_BAHASAN_LEBIH_DALAM>>>` … `<<<END_DRAFT_2>>>`, `<<<DRAFT_3_OBSERVASI_PENDEK>>>` … `<<<END_DRAFT_3>>>`. Model hanya mengisi teks; aplikasi menetapkan2pendek+1detail. Bukan3call tersembunyi. Tidak menambah repair/retry/fallback provider call. Crash recovery lama tetap mungkin mengulang attempt dan ditandai UNKNOWN, bukan exactly-once billing.
- Parser strict menolak pembuka/penutup tambahan, bagian kurang/lebih/urut atau label salah, delimiter bersarang/berdempetan satu baris, teks kosong/>500, normalized duplicate; CRLF diterima dan paragraf utuh. Ordinary purpose menolak delimiter TRY_THEME. Output invalid → FAILED/INVALID_OUTPUT terlihat,0draft baru, bukan partial success. STOP/safety, usage/modelVersion, key header server-only dan error aman tanpa raw body tetap.
- Voice/contoh tema/ownerNote terpilih/original/evidence tetap prompt data; tanpa pengalaman/sumber karangan. Quota/idempotensi, lock/version/provenance, invalidasi approval/backup dan trend review/jadwal tidak dilonggarkan. TRY_THEME tetap tanpa jadwal. Simulasi tetap independen/berlabel, tidak memakai mock provider sebagai bukti live.

## Jalur pengguna

Buka **Draft** atau **Tema & Gaya → Konten Gemini**. Pilih tema/fungsi: Ide konten, Post pendek, Bahasan lebih dalam, Revisi, atau **Coba tema**. Coba tema sukses menyimpan **tepat tiga draft berbeda setelah normalisasi Unicode NFKC, whitespace dan huruf kecil**, wajib campuran observasi pendek/bahasan lebih dalam reguler (tidak boleh semua satu format atau mengandung tren), dalam satu transaksi; tidak pernah membuat jadwal. Fungsi lain menyimpan satu draft (IDEAS berupa ide konkret yang perlu dirapikan). Revisi menarget ID+versi yang ditampilkan; bukan menimpa draft lain. Catatan pemilik opsional harus dipilih eksplisit. Semua contoh suara akun dan contoh tema masuk prompt sebagai JSON data, bukan instruksi. Simulation fixture mengikuti pilihan kata ganti `gue`/`aku` dan tema; bukan klaim kualitas Gemini live.

Tren hanya memakai URL HTTP(S), waktu sumber valid tidak di masa depan, dan alasan relevansi yang dikirim pemilik. Evidence yang disertakan selalu divalidasi, termasuk pada input format reguler dan kembali saat validasi output; bukan hanya ketika format input tren. Tidak ada pencarian web/grounding/discovery pada Fase 2. Sumber disalin dari input tervalidasi, bukan diambil dari output model. Output dengan field sumber tambahan ditolak. Tren selalu IN_REVIEW; revisi tren membatalkan jadwal aktif dan meminta review/jadwal baru sesuai policy Fase 1.

Bagian **Siapkan cadangan reguler** memungkinkan pemilik menyetujui draft reguler setelah ditinjau. Jika generasi gagal, request tetap FAILED (bukan tiga draft sukses). Tombol **Ambil draft reguler siap (cadangan)** benar-benar mengambil teks draft lama yang APPROVED, unlocked, tema aktif, bukan tren, dan tidak pernah memiliki jadwal. Eligibility diperiksa ulang saat diambil; fallback tidak mengubah konten/status atau menjadwalkan/publish otomatis. Persetujuan reguler dibatalkan menjadi DRAFT setelah perubahan substantif manual atau revisi AI (teks/tema/format/provenance); versi baru harus disetujui eksplisit sebelum eligible fallback lagi. Jadwal reguler tetap memakai policy replacement versi tersendiri, tidak dibatalkan diam-diam. Hasil cadangan bukan reservasi: operator masih perlu memeriksa saat menjadwalkan melalui policy jadwal yang ada.

## Konfigurasi server

Default aman tanpa key: `GENERATION_PROVIDER=simulation`, `GEMINI_ALLOW_OUTBOUND=false`. Adapter fixture deterministik berlabel SIMULASI. `DEMO_MODE=true` wajib untuk publikasi dan **tidak** memilih provider generasi.

Untuk operator yang sudah memberi izin terpisah menjalankan AI eksternal:

- Simpan key sendiri melalui secret/env server, **jangan chat**. `GEMINI_API_KEY` hanya dikirim Compose ke worker, bukan API/web/VITE bundle.
- Set `GENERATION_PROVIDER=gemini`, `GEMINI_ALLOW_OUTBOUND=true`, dan model eksplisit yang benar-benar tersedia pada akun serta mendukung `generateContent` dengan respons teks biasa. Tidak memerlukan dukungan JSON schema output.
- `GEMINI_MODEL` fallback bersama; override per fungsi `GEMINI_MODEL_IDEAS`, `_SHORT`, `_DEEP`, `_REVISE`, `_TRY_THEME`. Nilai kosong menggunakan fallback. Tidak ada model live default. Model disnapshot saat request diterima.
- Dokumentasi structured-output yang di-fetch langsung saat implementasi memberi contoh `gemini-4-hydrogen` (contoh Interactions API pada halaman yang berubah). **Itu contoh dokumentasi, bukan jaminan model tersedia/kompatibel generateContent pada akun ini.** Jangan menganggap daftar/model dari search atau dokumen lama sebagai bukti availability. Integrasi ini memakai REST generateContent yang masih didokumentasikan; uji live tertunda sampai operator memilih model/key dan memberi izin.
- Key/model/izin outbound yang tidak lengkap menghasilkan CONFIG dan kegagalan terlihat; **tidak** diam-diam dialihkan ke simulasi. Nama provider yang salah ditolak.
- `GENERATION_DAILY_LIMIT=20`: jumlah request baru yang diterima per kalender WIB, independen `dailyPostLimit`. Replay ID+input sama tidak menghitung ulang; input berbeda dengan ID sama ditolak. Failed requests tetap memakai kuota. Tidak meniru quota provider Google yang per project dan dapat reset pada Pacific time.
- `GEMINI_PRICING_JSON` opsional: JSON object per **exact actual model** (atau configured model jika API tidak memberi modelVersion), dengan `inputPerMillionUsd`, `outputPerMillionUsd`, angka finite nonnegative. Isi hanya harga yang diverifikasi operator. Tanpa harga/token lengkap atau provider simulation → SQL NULL. Tidak ada harga/biaya rekaan. Perkiraan bukan tagihan resmi; caching, tools, thinking tier/discount harus diperhitungkan operator sebelum mengisi harga yang sesuai.

Compose tetap empat service. Startup API menerapkan migrasi additive/idempotent 005 pada target stack saja. Jangan restart stack utama untuk QA; gunakan smoke terisolasi.

## Ketahanan dan batas bukti

`generation_requests` adalah durable outbox. Worker dispatcher merekonsiliasi request pending ke pg-boss `content.generate` dengan queue policy **exclusive**, singletonKey per request, retry terbatas per job. Advisory lock PostgreSQL per request melindungi dua worker; transaksi terminal menyimpan draft/result/attempt sukses atomik. Dispatcher tidak menahan row locks selama AI HTTP. Restart dari PROCESSING dapat mengulangi panggilan provider jika respons belum tersimpan; draft tetap idempoten. Percobaan lama ditandai UNKNOWN dan biaya/token yang hilang tetap null: **tidak mengklaim exactly-once panggilan atau penagihan AI**.

Revisi memeriksa unlocked, versi, status, tema/format dan provenance pada penerimaan; saat commit kembali memakai settings → draft → schedule locks serta versi/lock terbaru. Edit manual/lock-toggle selama AI berjalan menyebabkan CONFLICT tanpa menimpa pemilik. Saat commit, provenance personalSourceId/tema/format dan bukti tren dibandingkan lagi di bawah draft row lock terhadap snapshot request: penghapusan catatan pemilik lewat FK SET NULL (yang tidak menaikkan versi) juga menghasilkan CONFLICT, bukan menulis output berdasarkan sumber yang sudah hilang. Policy invalidasi jadwal, immutable execution snapshots Fase 1 tetap digunakan. Manual editor mengirim expectedVersion; backward-compatible API patch tanpa versi tetap diterima untuk klien Fase 1, tetapi revisi AI selalu wajib versi.

`generation_attempts` mencatat tiap percobaan provider/model, token jika tersedia, actual model, hasil/error aman dan biaya opsional. Envelope HTTP Gemini tetap JSON; hanya `candidates.content.parts.text` yang merupakan teks draft biasa, bukan objek JSON buatan model. Aplikasi menetapkan metadata lalu memvalidasi jumlah, format, distinct dan panjang sebelum persist. HTTP resmi menggunakan header `x-goog-api-key`, bukan query URL. Timeout 45 detik, response non-STOP/teks atau delimiter invalid/safety/429 terlihat dengan pesan tetap, tidak mencetak body provider atau rahasia. Tidak ada dependency/SDK baru; native fetch Node 24 dan Zod yang sudah dipin.

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

Live Gemini **PENDING**: uji terbatas sebelumnya gagal PROVIDER/INVALID_OUTPUT dan diagnostic Hydrogen timeout45detik (lihat sejarah di bawah). Adaptasi teks bukan bukti root cause sudah diperbaiki; panggilan baru memerlukan izin/budget baru. Checkpoint runtime `6ea5314` sudah diverifikasi parent dan disetujui reviewer independen. Fase 2 belum COMPLETE karena uji Gemini nyata masih tertunda. Posting Meta/reply/grounding/gambar tetap di luar scope.


## Uji Gemini nyata terbatas — 2026-11-22 WIB (belum berhasil)

Bagian ini menggantikan keterangan lama bahwa key/izin belum tersedia. Operator mengizinkan hanya uji generasi Gemini terbatas; secret diambil dari `.env` lokal, tidak dari chat. Main8080/admin/data/image tidak diubah, tidak ada publikasi/Meta, tidak commit/push dan Fase3 belum dimulai. Fase2 tetap **IMPLEMENTED / LIVE VERIFICATION PENDING**, bukan COMPLETE.

- Recovery aktual: Git clean `main`/`32dc486`, runtime `6ea5314`; `npm run test:all && npm run build` exit0:35 unit+69 PostgreSQL integration PASS,0 failed/skip; build5workspace PASS. Main `/health` tetap200/demo=true.
- Dokumentasi resmi https://ai.google.dev/api/models diambil langsung HTTP200; snapshot `/home/deva/.hermes/cache/scratch/gemini-official-models.html`. GET resmi `/v1beta/models` memakai header `x-goog-api-key`, HTTP200/1page; snapshot nonsecret `/home/deva/.hermes/cache/scratch/threads-gemini-model-list.json`. Daftar mendukung generateContent termasuk stable Flash-Lite2.5 dan3.5; models.list tidak menjamin akses generasi nyata.
- `.env` awal: key present, provider=gemini, outbound=true, model dan seluruh override fungsi blank, pricing tidak diisi. Hanya `GEMINI_MODEL` yang awalnya kosong diisi; akhir `gemini-3.5-flash-lite`, mode0600, seluruh field lain dipertahankan. Model2.5 awal yang dipilih dari daftar dikoreksi karena404 unavailable. Default akhir bukan klaim output berhasil. QA memakai provider=gemini/outbound=true; key hanya worker, API tanpa key, DEMO_MODE=true; blank override memakai fallback.
- QA fresh: `threads-gemini-live-7354c655`, web **18091**, DB **15448**, empat service terisolasi; tidak menyentuh volume utama. Env sensitif `/home/deva/.hermes/cache/scratch/threads-gemini-live-Fi0f1D/compose.env`0600: jangan dicetak/dibaca ke chat. Fixture sesi browser sibling `browser-fixture.json`0600; login hanya HTTP fixture, bukan form browser.
- **Total3 generation HTTP calls, berhenti pada batas**: (1) Coba tema2.5 request `d170c7d3-c0c4-4f95-9b1d-e58b426a0d8f` FAILED/PROVIDER, attempt `c20dc024-a70f-4c62-a21b-3f19b2e8a4d8`; (2) diagnostik host payload adapter identik2.5, HTTP404 Google NOT_FOUND: `This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements. We recommend you to use the Interactions API (https://aistudio.google.com/docs/get-started).`; (3) satu alternatif kompatibel dari models.list3.5 Coba tema request `7c8ef206-579e-468c-9b6a-d62658f80a2f` FAILED/INVALID_OUTPUT, attempt `28e8a6fd-9212-43a5-9959-340b72dfbd1d`. Tidak ada retry quota evasion atau panggilan keempat.
- DB/API readback:2requests/2failed/2attempts/0UNKNOWN; diagnostik host tidak masukDB. **0 draft,0 jadwal**. usage/modelVersion/cost semuanya null/tidak diketahui; bukan pemakaian atau biaya nol. Actual modelVersion dan kualitas teks Indonesia/gaya belum dapat diverifikasi. Penyebab INVALID_OUTPUT spesifik tidak diketahui karena adapter menyamarkan detail dan tidak menyimpan respons gagal; tidak mengarang teks/usage dan tidak mengubah kode produksi tanpa RED/GREEN.
- Bukti nonsecret sibling: `evidence.json` (request awal), `diagnostic.json` (404 teredaksi), `alternative-evidence.json` (readback akhir). Harness bounded di scratch `threads-gemini-{discover,live,diagnose,alternative}.mjs`; source tidak memuat key literal. Handle `/home/deva/.hermes/cache/scratch/threads-gemini-live-handle.json`.
- Next exact action: parent verifikasi read-only IDs/evidence/stack; minta izin terpisah untuk diagnostik output baru jika diperlukan (batas3call habis). Bila bug dibuktikan, RED/GREEN sebelum perbaikan. Jangan deploy main, lanjutFase3 atau markCOMPLETE. Stack QA ditinggal running untuk review; tidak ada proses harness background. Stop hanya project ini via Compose envfile/project di atas, tanpa `-v`.

## Uji Hydrogen yang diizinkan — 2026-11-22 WIB

Izin baru terbatas untuk Gemini 4 Hydrogen saja, maksimal2 generateContent; bukan izin fallback model atau migrasi Interactions. Recovery `main` clean HEAD `e23e7c7`, runtime `6ea5314`. `npm run test:all && npm run build` exit0:35unit+69integrasi PostgreSQL PASS,0gagal/skip; build5workspace PASS.

- GET resmi `https://generativelanguage.googleapis.com/v1beta/models` via header `x-goog-api-key`, HTTP200,1page lengkap/65model, memuat **`models/gemini-4-hydrogen`**, displayName Gemini 4 Hydrogen, methods `generateContent`, `countTokens`, `batchGenerateContent`. Bukti0600 `/home/deva/.hermes/cache/scratch/threads-hydrogen-discovery.json`; dokumentasi resmi models HTTP200 disimpan `threads-hydrogen-official-models.html` di scratch yang sama. Terdaftar bukan jaminan akses generasi berhasil.
- Hanya GEMINI_MODEL pada `.env` lokal dan envFile QA yang diubah ke `gemini-4-hydrogen` (ID resmi tanpa prefix resource `models/`, sesuai adapter). Readback model benar; mode0600; key/field lain dipertahankan, seluruh override fungsi blank. Ini **konfigurasi percobaan, bukan model default tervalidasi**. Main8080/image/admin/data tidak diredeploy/diubah.
- QA existing `threads-gemini-live-7354c655`18091/15448: API/worker/web diperbarui konfigurasi saja,4servicehealthy. Inspect tersaring membuktikan key hanya worker, bukan API/web; API+worker DEMO_MODE=true. Fixture cookies tersimpan digunakan diam-diam, tidak mengetik password atau mengubah admin.
- **1 generateContent application attempt pada izin baru,0diagnostic call**. Coba tema request **`2373db37-984c-4332-986a-50c7dc5374a0`**, attempt **`6f46f587-2457-4ab6-86ee-7f342a49490a`**, GEMINI/gemini-4-hydrogen → **FAILED / PROVIDER**. Berhenti: izin diagnostic bersyarat INVALID_OUTPUT tidak berlaku pada error ini. HTTP status/body/alasan provider spesifik tidak tertangkap adapter; jangan menyebutnya404/quota/incompatibility tanpa bukti. Tidak mencoba model lain/retry/Interactions.
- Readback exact request/attempt dan API:0draft dari request ini,0schedule; total QA3requests/3failed/3attempts/0UNKNOWN. actual_model/usage/cost null (tidak diketahui, bukan nol). Belum ada bukti3draftdistinct/mixed atau kualitas/gaya Indonesia nyata. Batas aplikasi dailyLimit3 sudah tercapai; tidak dinaikkan untuk mengelak kuota.
- Evidence0600 `/home/deva/.hermes/cache/scratch/threads-hydrogen-live-evidence.json`; harness source tanpa key literal `threads-hydrogen-{discovery,live}.mjs` di scratch yang sama. Tidak ada background harness; QA ditinggal running untuk parent readback. Main `/health` HTTP200/demo=true; `git diff --check` PASS. Tidak ada code fix/regression baru karena belum ada bug yang terbukti; tidak ada Meta/posting/commit/push.
- Status tetap **Fase2 IMPLEMENTED / LIVE VERIFICATION PENDING / IN PROGRESS**, bukan COMPLETE. Next exact action: parent verifikasi request/attemptDB dan evidence; jika ingin diagnosis error PROVIDER baru, perlu izin terpisah yang secara eksplisit mencakup satu diagnostic call persis payload/model, tanpa retry/fallback atau ubah quota. Dua call maksimum adalah batas, bukan kewajiban menghabiskan budget.

### Diagnostic Hydrogen eksplisit — budget2/2 terpakai

Parent kemudian mengonfirmasi readbackDB FAILED/PROVIDER,0draft/0schedule dan secara eksplisit mengizinkan tepat1 diagnostic call untuk kegagalan PROVIDER. Izin baru ini menggantikan syarat diagnostic sebelumnya. Menjalankan `node /home/deva/.hermes/cache/scratch/threads-hydrogen-diagnostic.mjs` sekali: adapter `callGemini` yang sama, input/context tersimpan request `2373db37-984c-4332-986a-50c7dc5374a0`, model listed `gemini-4-hydrogen`, exact application payload; key hanya dibaca diam-diam dari `.env` server untuk header resmi, tidak dicetak/disimpan dalam evidence.

- Diagnostic mulai `2026-11-21T17:27:40.392Z`, berakhir `2026-11-21T17:28:25.428Z`: **TIMEOUT pada batas adapter45000ms sebelum respons HTTP diterima**. Actual HTTPstatus=null; Google code/message=null; response headers/retry-after=null; actualModel/usage=null. Ini bukan HTTP error tertentu atau bukti quota/unavailability; penyebab PROVIDER pertama tetap tidak diketahui. Tidak mengarang status/message yang tidak diterima.
- **Total Hydrogen2 generateContent calls**:1application+1host diagnostic; budget habis. Tidak retry, fallback, model switch, atau Interactions. Host diagnostic tidak membuat requestDB/draft/jadwal dan bukan bukti aplikasi sukses. Tidak ada produksi code edits/commit/push/main deploy; konfigurasi dan secret tidak diubah pada diagnostic.
- Evidence sanitized0600: `/home/deva/.hermes/cache/scratch/threads-hydrogen-diagnostic.json`; harness source sibling `threads-hydrogen-diagnostic.mjs`, guard file eksklusif mencegah rerun. Respons bila ada disanitasi literal key sebelum write; pada eksekusi ini tidak ada respons yang bisa direkam. Tests/build35+69/5workspace sebelumnya tetap bukti recovery, tidak diulang untuk perubahan dokumentasi saja.
- Fase2 tetap IMPLEMENTED / LIVE VERIFICATION PENDING / IN PROGRESS. Rekomendasi: parent baca evidence; periksa akses akun/model dan status layanan/jaringan secara read-only. Jangan menyimpulkan model tak tersedia atau mengganti API/model otomatis; panggilan generation berikut memerlukan izin/budget baru, bukan retry diam-diam. Tidak ada background diagnostic process.
