# Fase 4 — Tren, Reply, Discovery

Bertahap: **4A** discovery + skor + review dulu, **4B** reply kemudian.

**Status: 4A = LIVE VERIFIED (2026-11-22).** Discovery nyata 5 sumber RSS: 215 item, 115 baru, 5 draft kandidat, 0 kegagalan; UI menu Tren terverifikasi di DOM. Gate: 89 unit + 101 integrasi PASS. Live posting tetap MATI.

Keputusan operator (2026-11-22):
- Sumber: RSS portal berita Indonesia (detik, Kompas, CNN Indonesia, Antara, Republika). Threads app trends dipakai bila ada API resmi.
- Alur: skor ≥ ambang → otomatis jadi draft `TREN_RELEVAN` → **tetap lewat review** (tidak pernah terkirim otomatis).
- Reply: ya, dengan scope tambahan `threads_manage_replies` + `threads_read_replies` (perlu re-OAuth); live mati, pause terpisah, anti-duplikat, kuota terpisah.

## 4A — Discovery + skor + review

**Sumber & normalisasi**
- Provider RSS/Atom di `apps/worker/src/trend-provider.ts`, tanpa dependensi baru (parser minimal untuk `<item>`/`<entry>`).
- Item dinormalisasi: `source`, `source_name`, `title`, `url`, `summary`, `published_at`, `categories`, `raw`.
- Dedupe `(source, url)`; mentah disimpan untuk audit.

**Skor relevansi (0–100)**
- Sinyal: kedekatan kata kunci tema, kebaruan, sumber terpercaya, kategori.
- Setiap poin tercatat di `trend_candidates.reasons` (audit, bukan angka hitam).
- Ambang diatur di `trend_settings.threshold` (default 60).

**Alur**
- Discovery dipicu manual dari dashboard dan/atau berkala.
- Item ≥ ambang → dibuatkan draft `TREN_RELEVAN` (`source_url`, `source_time`, `relevance_note` = ringkasan alasan skor) → status `IN_REVIEW` (alur review yang sudah ada).
- Di bawah ambang → tetap disimpan sebagai item, tidak jadi draft.
- Operator bisa membuka/buang kandidat.

## 4B — Reply (ringkas)

- Endpoint Meta: `POST /v1.0/me/threads` (`media_type=TEXT`, `text`, `reply_to_id`) → `POST /{user-id}/threads_publish`.
- Scope baru `threads_manage_replies` + `threads_read_replies` → token lama perlu re-OAuth.
- Antrean `reply_queue` + `reply_attempts`, klaim atomik, status `QUEUED`/`REPLIED`/`NEEDS_REVIEW`/`FAILED`/`DUPLICATE`.
- Pause reply terpisah dari publikasi; kuota reply (1.000/24 jam) dibaca dari Meta.
- **Live reply default mati**; tidak ada balasan nyata tanpa toggle operator.

## Batas & bukti
- Semua transport eksternal dimock di test; QA runtime memakai stack terisolasi dengan live MATI.
- Discovery gagal/rate-limit dicatat, tidak menghasilkan draft palsu.
