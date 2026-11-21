-- Phase 1: dashboard editorial dan kontrol admin (satu admin, session opaque, jadwal versi + outbox).

CREATE TABLE IF NOT EXISTS admin_users (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY,
  username text NOT NULL,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS themes (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('UTAMA','SELINGAN')),
  weight integer NOT NULL CHECK (weight BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS theme_examples (
  id uuid PRIMARY KEY,
  theme_id uuid NOT NULL REFERENCES themes (id) ON DELETE CASCADE,
  text text NOT NULL CHECK (length(trim(text)) > 0),
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS editorial_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  format_mix jsonb NOT NULL,
  daily_post_limit integer NOT NULL CHECK (daily_post_limit BETWEEN 1 AND 20),
  paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voice_examples (
  id uuid PRIMARY KEY,
  text text NOT NULL CHECK (length(trim(text)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS personal_sources (
  id uuid PRIMARY KEY,
  note text NOT NULL CHECK (length(trim(note)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS review_topics (
  id uuid PRIMARY KEY,
  topic text NOT NULL CHECK (length(trim(topic)) > 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY,
  theme_id uuid NOT NULL REFERENCES themes (id),
  format text NOT NULL CHECK (format IN ('OBSERVASI_PENDEK','BAHASAN_LEBIH_DALAM','TREN_RELEVAN')),
  text text NOT NULL CHECK (length(trim(text)) > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','SCHEDULED','CANCELLED')),
  locked boolean NOT NULL DEFAULT false,
  source_url text,
  source_time timestamptz,
  relevance_note text,
  personal_source_id uuid REFERENCES personal_sources (id) ON DELETE SET NULL,
  review_note text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_status_idx ON drafts (status);

CREATE TABLE IF NOT EXISTS schedule_entries (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES drafts (id),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_entries_status_at_idx ON schedule_entries (status, scheduled_at);

CREATE TABLE IF NOT EXISTS schedule_outbox (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL,
  version integer NOT NULL,
  event text NOT NULL CHECK (event IN ('UPSERT','CANCEL')),
  scheduled_at timestamptz,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_outbox_pending_idx ON schedule_outbox (processed, created_at);

CREATE TABLE IF NOT EXISTS schedule_executions (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES schedule_entries (id),
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('SIMULATED_OK','SKIPPED_STALE','SKIPPED_CANCELLED','SKIPPED_PAUSED','SKIPPED_LIMIT','CANCELLED','FAILED')),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, version)
);
CREATE INDEX IF NOT EXISTS schedule_executions_created_idx ON schedule_executions (created_at DESC);
