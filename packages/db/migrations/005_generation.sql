-- Phase 2 additive/idempotent: durable generation requests are their own outbox.
CREATE TABLE IF NOT EXISTS generation_requests (
 id uuid PRIMARY KEY,
 input jsonb NOT NULL,
 context jsonb NOT NULL,
 provider text NOT NULL CHECK(provider IN ('SIMULATION','GEMINI')),
 model text NOT NULL,
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','COMPLETED','FAILED')),
 draft_ids uuid[] NOT NULL DEFAULT '{}',
 usage jsonb,
 actual_model text,
 estimated_cost numeric,
 error_code text,
 error text,
 fallback_draft_id uuid REFERENCES drafts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS generation_attempts (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES generation_requests(id),
 provider text NOT NULL,
 model text NOT NULL,
 status text NOT NULL DEFAULT 'STARTED',
 usage jsonb,
 actual_model text,
 estimated_cost numeric,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS generation_pending_idx ON generation_requests(status,created_at);
