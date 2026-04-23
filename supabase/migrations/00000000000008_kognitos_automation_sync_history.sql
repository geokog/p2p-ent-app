-- Append-only log of each automation sync pass (POST /api/kognitos/sync loop).

CREATE TABLE kognitos_automation_sync_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kognitos_automation_id uuid NOT NULL REFERENCES kognitos_automations (id) ON DELETE CASCADE,
  synced_at timestamptz NOT NULL DEFAULT now(),
  new_runs_inserted integer NOT NULL DEFAULT 0,
  runs_fetched_from_api integer NOT NULL DEFAULT 0,
  runs_skipped_duplicates integer NOT NULL DEFAULT 0,
  sync_mode text NOT NULL DEFAULT 'incremental'
);

CREATE INDEX idx_kognitos_sync_history_time ON kognitos_automation_sync_history (synced_at DESC);
CREATE INDEX idx_kognitos_sync_history_automation ON kognitos_automation_sync_history (kognitos_automation_id, synced_at DESC);

ALTER TABLE kognitos_automation_sync_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON kognitos_automation_sync_history FOR SELECT USING (true);

COMMENT ON TABLE kognitos_automation_sync_history IS
  'One row per automation per Kognitos list-runs sync pass; grows with each top-bar sync.';
