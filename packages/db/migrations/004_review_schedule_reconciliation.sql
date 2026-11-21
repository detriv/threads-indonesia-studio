-- Repair pre-fix edited/rejected trends left active. Re-running does not reactivate or duplicate anything.
BEGIN;
SELECT id FROM editorial_settings WHERE id = 1 FOR UPDATE;
DO $$
DECLARE entry record;
BEGIN
  FOR entry IN
    SELECT s.id, s.version FROM schedule_entries s JOIN drafts d ON d.id = s.draft_id
    WHERE s.status = 'SCHEDULED' AND (
      d.status IN ('IN_REVIEW', 'CANCELLED') OR
      (d.format = 'TREN_RELEVAN' AND d.status NOT IN ('APPROVED', 'SCHEDULED'))
    ) FOR UPDATE OF s
  LOOP
    UPDATE schedule_entries SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE id = entry.id;
    INSERT INTO schedule_outbox (id, schedule_id, version, event)
      VALUES (gen_random_uuid(), entry.id, entry.version + 1, 'CANCEL');
    INSERT INTO schedule_executions (id, schedule_id, version, status, error)
      VALUES (gen_random_uuid(), entry.id, entry.version + 1, 'CANCELLED', 'Rekonsiliasi: draft tidak eligible; review dan jadwal baru diperlukan')
      ON CONFLICT (schedule_id, version) DO NOTHING;
  END LOOP;
END $$;
COMMIT;
