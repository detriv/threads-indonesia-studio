-- Phase 4A additive/idempotent: discovery tren, skor relevansi, kandidat draft.
CREATE TABLE IF NOT EXISTS trend_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  paused boolean NOT NULL DEFAULT false,
  threshold integer NOT NULL DEFAULT 60 CHECK (threshold BETWEEN 0 AND 100),
  daily_limit integer NOT NULL DEFAULT 20 CHECK (daily_limit BETWEEN 1 AND 100),
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO trend_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Mentah hasil discovery, disimpan untuk audit; dedupe per (sumber, url).
CREATE TABLE IF NOT EXISTS trend_items (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  source_name text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  summary text,
  published_at timestamptz,
  categories text[] NOT NULL DEFAULT '{}',
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, url)
);
CREATE INDEX IF NOT EXISTS trend_items_recent_idx ON trend_items (published_at DESC);
CREATE INDEX IF NOT EXISTS trend_items_fetched_idx ON trend_items (fetched_at DESC);

-- Hasil penskoran: di atas ambang berubah jadi draft TREN_RELEVAN (masuk review).
CREATE TABLE IF NOT EXISTS trend_candidates (
  id uuid PRIMARY KEY,
  trend_item_id uuid NOT NULL REFERENCES trend_items(id) ON DELETE CASCADE,
  draft_id uuid REFERENCES drafts(id) ON DELETE SET NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  threshold integer NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONVERTED', 'DISMISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trend_candidates_status_idx ON trend_candidates (status, created_at DESC);
CREATE INDEX IF NOT EXISTS trend_candidates_item_idx ON trend_candidates (trend_item_id);

-- Satu kandidat per item tren: mencegah draft ganda saat discovery berulang.
CREATE UNIQUE INDEX IF NOT EXISTS trend_candidates_item_unique ON trend_candidates (trend_item_id);

-- Permintaan discovery dari dashboard; worker dispatcher yang mengantrekan ke pg-boss.
CREATE TABLE IF NOT EXISTS trend_runs (
  id uuid PRIMARY KEY,
  requested_by text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'DONE', 'FAILED')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trend_runs_pending_idx ON trend_runs (status, created_at);
