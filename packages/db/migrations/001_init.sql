CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS demo_actions (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind = 'SYNTHETIC_AGE_20S'),
  status text NOT NULL CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','FAILED')),
  demo boolean NOT NULL DEFAULT true CHECK (demo = true),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS demo_actions_created_at_idx ON demo_actions (created_at DESC);
