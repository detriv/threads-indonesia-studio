-- Phase 4C additive/idempotent: kotak masuk balasan dari postingan kita.
CREATE TABLE IF NOT EXISTS reply_inbox (
  id uuid PRIMARY KEY,
  reply_media_id text NOT NULL UNIQUE,
  root_post_id text,
  username text,
  text text NOT NULL,
  draft_text text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DISMISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reply_inbox_status_idx ON reply_inbox (status, created_at DESC);

-- Permintaan tarik inbox dari dashboard; worker dispatcher yang mengantrekan ke pg-boss.
CREATE TABLE IF NOT EXISTS reply_runs (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'DONE', 'FAILED')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reply_runs_pending_idx ON reply_runs (status, created_at);
