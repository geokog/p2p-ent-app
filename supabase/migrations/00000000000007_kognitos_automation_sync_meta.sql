-- Last successful run-list sync per registered automation (see lib/kognitos/sync.ts).

ALTER TABLE kognitos_automations
  ADD COLUMN last_runs_sync_at timestamptz,
  ADD COLUMN last_sync_new_runs_inserted integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN kognitos_automations.last_runs_sync_at IS
  'When this automation was last processed by POST /api/kognitos/sync (Kognitos ListRuns + Supabase insert/refresh).';
COMMENT ON COLUMN kognitos_automations.last_sync_new_runs_inserted IS
  'Number of new kognitos_runs rows inserted for this automation in that last sync pass.';
