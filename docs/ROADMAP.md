# Roadmap

Status kini: Fase 1 COMPLETE, Fase 2 **IN PROGRESS** (parent review dan live Gemini PENDING karena key/izin belum tersedia); Fase 3–6 belum dimulai. Lihat [konfigurasi dan bukti Fase 2](PHASE2.md).

| Fase | Hasil | Kriteria utama |
|---|---|---|
| 0 — Fondasi | Monorepo, Compose empat service, migrasi, health, dan smoke job | Stack bersih tanpa kredensial eksternal; hasil job muncul di dashboard dan bertahan setelah restart |
| 1 — Dashboard editorial | Login, Tema & Gaya, kalender, review, riwayat, status integrasi | Empat tema dan porsi format 70/20/10 yang bisa diedit; buat tema, edit/kunci draft, jadwal ulang/batal, dan filter riwayat dengan adapter simulasi |
| 2 — Konten Gemini | Ide, konten pendek/detail, revisi, tombol Coba tema | Tiga draft tanpa jadwal; gaya akun, pemakaian dan sumber, kuota terlihat, fallback draft reguler |
| 3 — Posting Threads | Meta OAuth, posting manual dan terjadwal | Satu post akun uji yang diizinkan; aman dari duplikat saat timeout/restart/reschedule/concurrency |
| 4 — Tren, reply, discovery | Sumber resmi, skor relevansi, review dan reply | Tren relevan dengan bukti sumber; slot bisa diisi konten reguler; tanpa reply ganda; pause terpisah |
| 5 — Gambar | Ilustrasi opsional, preview, alt text, URL media | Batas dipatuhi sebelum panggilan API; kegagalan media terlihat dan dapat ditangani |
| 6 — Siap operasional | Backup/restore, pemulihan token, pantauan, deploy | Restore dan kegagalan diuji; hasil simulasi dibedakan dari hasil akun sungguhan |

Fokus: Pertemanan dan chat, Kerja dan kuliah, Kebiasaan digital sebagai tema utama; Uang dan jajan sebagai selingan. Bahasa Indonesia santai dan humor observasional. Target awal 70% observasi pendek, 20% bahasan lebih dalam, 10% tren relevan. Pengalaman pribadi berasal dari catatan pemilik saja. Publikasi/reply live mati secara default dan tak boleh diaktifkan tanpa izin eksplisit.
