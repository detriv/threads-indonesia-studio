-- Additive Phase 1 history snapshots. Never infer old attribution from today's draft.
CREATE TABLE IF NOT EXISTS schedule_versions (
  schedule_id uuid NOT NULL REFERENCES schedule_entries(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (schedule_id, version)
);
ALTER TABLE schedule_executions ADD COLUMN IF NOT EXISTS snapshot jsonb;

-- Existing executions predate snapshots: only result/outbox evidence is historical.
UPDATE schedule_executions e SET snapshot = jsonb_build_object(
  'draftId', s.draft_id, 'draftText', e.result->>'text',
  'themeId', e.result->>'themeId', 'themeName', e.result->>'themeName',
  'format', e.result->>'format', 'draftStatus', NULL,
  'scheduledAt', COALESCE((SELECT o.scheduled_at FROM schedule_outbox o
    WHERE o.schedule_id = e.schedule_id AND o.version = e.version AND o.event = 'UPSERT'
    ORDER BY o.created_at LIMIT 1), CASE WHEN s.version = e.version THEN s.scheduled_at END),
  'provenance', 'LEGACY_PARTIAL'
) FROM schedule_entries s WHERE s.id = e.schedule_id AND e.snapshot IS NULL;

-- Current versions are recoverable as current state, not asserted historical executions.
INSERT INTO schedule_versions (schedule_id, version, snapshot)
SELECT s.id, s.version, jsonb_build_object(
  'draftId', d.id, 'draftText', d.text, 'themeId', d.theme_id, 'themeName', t.name,
  'format', d.format, 'draftStatus', d.status, 'scheduledAt', s.scheduled_at,
  'provenance', 'LEGACY_CURRENT_STATE'
) FROM schedule_entries s JOIN drafts d ON d.id = s.draft_id JOIN themes t ON t.id = d.theme_id
ON CONFLICT (schedule_id, version) DO NOTHING;

CREATE OR REPLACE FUNCTION capture_schedule_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO schedule_versions (schedule_id, version, snapshot)
  SELECT NEW.id, NEW.version, jsonb_build_object(
    'draftId', d.id, 'draftText', d.text, 'themeId', d.theme_id, 'themeName', t.name,
    'format', d.format, 'draftStatus', d.status, 'scheduledAt', NEW.scheduled_at,
    'provenance', 'CAPTURED'
  ) FROM drafts d JOIN themes t ON t.id = d.theme_id WHERE d.id = NEW.draft_id
  ON CONFLICT (schedule_id, version) DO NOTHING;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER schedule_version_snapshot AFTER INSERT OR UPDATE OF version ON schedule_entries
FOR EACH ROW EXECUTE FUNCTION capture_schedule_version();

CREATE OR REPLACE FUNCTION capture_execution_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE metadata jsonb;
BEGIN
  SELECT snapshot INTO metadata FROM schedule_versions WHERE schedule_id = NEW.schedule_id AND version = NEW.version;
  -- Unknown/stale pre-migration versions must not borrow current metadata.
  NEW.snapshot := COALESCE(metadata, jsonb_build_object('provenance', 'LEGACY_PARTIAL'));
  -- Status is event-time state only for the matching current version; stale versions keep their own evidence.
  IF EXISTS (SELECT 1 FROM schedule_entries WHERE id = NEW.schedule_id AND version = NEW.version) THEN
    NEW.snapshot := NEW.snapshot || (SELECT jsonb_build_object('draftStatus', d.status)
      FROM schedule_entries s JOIN drafts d ON d.id = s.draft_id WHERE s.id = NEW.schedule_id);
  END IF;
  -- A successful simulation's result is evidence of the content actually processed.
  IF NEW.status = 'SIMULATED_OK' THEN
    NEW.snapshot := NEW.snapshot || jsonb_strip_nulls(jsonb_build_object(
      'draftText', NEW.result->>'text', 'themeName', NEW.result->>'themeName', 'format', NEW.result->>'format'
    ));
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER execution_snapshot BEFORE INSERT ON schedule_executions
FOR EACH ROW EXECUTE FUNCTION capture_execution_snapshot();
