-- Phase 3 additive/idempotent: Meta Threads connection, publish attempts, manual post queue.
-- Credentials (app id/secret, user token) live only in server env, never in this schema.
CREATE TABLE IF NOT EXISTS threads_connection (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_id text,
  app_secret_present boolean NOT NULL DEFAULT false,
  user_id text,
  access_token_present boolean NOT NULL DEFAULT false,
  token_expires_at timestamptz,
  scopes text,
  status text NOT NULL DEFAULT 'DISCONNECTED'
    CHECK (status IN ('DISCONNECTED', 'CONNECTED', 'TOKEN_EXPIRED', 'AUTH_ERROR', 'SCOPE_MISSING', 'RATE_LIMITED', 'NOT_CONFIGURED')),
  live_posting boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Satu sumber kebenaran untuk "posting manual dari dashboard" + eksekusi terjadwal.
CREATE TABLE IF NOT EXISTS publish_queue (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES drafts(id),
  schedule_id uuid REFERENCES schedule_entries(id) ON DELETE SET NULL,
  trigger text NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULED')),
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'CONTAINER_CREATED', 'PUBLISHED', 'NEEDS_REVIEW', 'FAILED', 'DUPLICATE', 'REQUIRES_LIVE')),
  container_id text,
  media_id text,
  published_url text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,
  last_error text,
  requested_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publish_queue_pending_idx ON publish_queue (status, created_at);
CREATE INDEX IF NOT EXISTS publish_queue_schedule_idx ON publish_queue (schedule_id);

-- Append-only attempts: satu baris per panggilan Meta yang mungkin sudah terkirim.
CREATE TABLE IF NOT EXISTS publish_attempts (
  id uuid PRIMARY KEY,
  queue_id uuid NOT NULL REFERENCES publish_queue(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('CREATE_CONTAINER', 'PUBLISH', 'STATUS', 'QUOTA')),
  outcome text NOT NULL CHECK (outcome IN ('OK', 'AMBIGUOUS', 'DUPLICATE', 'FAILED', 'BLOCKED')),
  http_status integer,
  error_code text,
  error text,
  container_id text,
  media_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publish_attempts_queue_idx ON publish_attempts (queue_id, created_at);

-- Phase 3: eksekusi jadwal bisa berisi status posting live.
ALTER TABLE schedule_executions DROP CONSTRAINT IF EXISTS schedule_executions_status_check;
ALTER TABLE schedule_executions ADD CONSTRAINT schedule_executions_status_check CHECK (status IN (
  'SIMULATED_OK','PUBLISHED','SKIPPED_STALE','SKIPPED_CANCELLED','SKIPPED_PAUSED','SKIPPED_LIMIT',
  'CANCELLED','FAILED','NEEDS_REVIEW','DUPLICATE','REQUIRES_LIVE','QUEUED'
));

-- Ambiguitas after-send: jangan kirim ulang sebelum rekonsiliasi operator.
CREATE OR REPLACE FUNCTION guard_publish_state_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' THEN
    IF OLD.status = 'NEEDS_REVIEW' AND NEW.media_id IS NULL THEN
      RAISE EXCEPTION 'PUBLISHED dari NEEDS_REVIEW memerlukan media_id';
    END IF;
    IF NEW.media_id IS NULL THEN
      RAISE EXCEPTION 'PUBLISHED wajib memuat media_id dari Meta';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS publish_state_transition ON publish_queue;
CREATE TRIGGER publish_state_transition BEFORE UPDATE OF status ON publish_queue
FOR EACH ROW EXECUTE FUNCTION guard_publish_state_transition();

-- Threads: teks maksimal 500 karakter; emoji dihitung byte UTF-8. Penegakan sebelum panggilan API.
CREATE OR REPLACE FUNCTION guard_publish_text_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE draft_text text;
BEGIN
  SELECT text INTO draft_text FROM drafts WHERE id = NEW.draft_id;
  -- Meta menghitung batas 500 dengan byte UTF-8 (emoji = beberapa byte), bukan jumlah kodepoint.
  IF octet_length(draft_text) > 500 THEN
    RAISE EXCEPTION 'Teks draft melebihi 500 byte UTF-8 (Threads)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS publish_text_limit ON publish_queue;
CREATE TRIGGER publish_text_limit BEFORE INSERT ON publish_queue
FOR EACH ROW EXECUTE FUNCTION guard_publish_text_limit();
