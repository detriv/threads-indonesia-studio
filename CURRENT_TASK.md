# CURRENT TASK

- Fase: 1 — Dashboard editorial.
- Status: IMPLEMENTED / VERIFICATION PENDING. Kode simulasi lokal lulus gates; QA manual login/confirm masih tersisa.
- Verified runtime commit: `7bea826`; documentation checkpoint terpisah.
- Done: login/logout/session/CSRF/rate-limit, empat tema/porsi editable, gaya/catatan/topik/batas, draft/edit/lock/review, jadwal/outbox/version/cancel/pause, riwayat snapshot immutable, status integrasi jujur, UI Indonesia dan WIB.
- Review blockers: ketiganya fixed dan disetujui reviewer ulang: renewed trend review gate, kuota konkuren, immutable history.
- Tests/build: 17 unit + 52 integrasi PASS, lint/typecheck/build/audit PASS; Docker smoke/restart dan browser fixture PASS.
- QA limits: form password browser dan konfirmasi native belum fully exercised; login/session diuji HTTP dan PostgreSQL. Tidak ada klaim uji akun eksternal.
- Next exact action: setup admin lokal via `npm run hash-password`, jalankan stack utama dan validasi manual login serta konfirmasi pembatalan. Tunggu izin sebelum Fase 2 Gemini.
- Out of scope: deployment publik, Meta/Gemini live, posting nyata, push Git.
