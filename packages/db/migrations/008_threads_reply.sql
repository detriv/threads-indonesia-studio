-- Phase 4B additive/idempotent: antrean balasan Threads, terpisah dari publish post.
-- Live balasan MATI secara default dan punya pause/kuota sendiri.
CREATE TABLE IF NOT EXISTS reply_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  live_posting boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  daily_limit integer NOT NULL DEFAULT 20 CHECK (daily_limit BETWEEN 1 AND 100),
  quota_usage integer,
  quota_total integer CHECK (quota_total IS NULL OR quota_total > 0),
  quota_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO reply_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS reply_queue (
  id uuid PRIMARY KEY,
  reply_to_id text NOT NULL,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'CONTAINER_CREATED', 'REPLIED', 'NEEDS_REVIEW', 'FAILED', 'DUPLICATE', 'REQUIRES_LIVE')),
  container_id text,
  media_id text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,
  last_error text,
  requested_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Anti-duplikat: media yang sama tidak dibalas dua kali dengan teks yang sama.
CREATE UNIQUE INDEX IF NOT EXISTS reply_queue_reply_to_text_unique ON reply_queue (reply_to_id, text);
CREATE INDEX IF NOT EXISTS reply_queue_pending_idx ON reply_queue (status, created_at);

CREATE TABLE IF NOT EXISTS reply_attempts (
  id uuid PRIMARY KEY,
  queue_id uuid NOT NULL REFERENCES reply_queue(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('CREATE_CONTAINER', 'PUBLISH', 'STATUS', 'QUOTA')),
  outcome text NOT NULL CHECK (outcome IN ('OK', 'AMBIGUOUS', 'DUPLICATE', 'FAILED', 'BLOCKED')),
  http_status integer,
  error_code text,
  error text,
  container_id text,
  media_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reply_attempts_queue_idx ON reply_attempts (queue_id, created_at);

-- REPLIED wajib memuat media_id dari Meta.
CREATE OR REPLACE FUNCTION guard_reply_state_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'REPLIED' AND NEW.media_id IS NULL THEN
    RAISE EXCEPTION 'REPLIED wajib memuat media_id dari Meta';
  END IF;
  IF octet_length(NEW.text) > 500 THEN
    RAISE EXCEPTION 'Teks balasan melebihi 500 byte UTF-8 (Threads)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reply_state_transition ON reply_queue;
CREATE TRIGGER reply_state_transition BEFORE INSERT OR UPDATE OF status, text ON reply_queue
FOR EACH ROW EXECUTE FUNCTION guard_reply_state_transition();
