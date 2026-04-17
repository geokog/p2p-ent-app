-- Parent table for registered Kognitos automations; kognitos_runs belong to one automation.

CREATE TABLE kognitos_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id text NOT NULL UNIQUE,
  resource_name text,
  display_name text,
  description text,
  org_id text REFERENCES organizations (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kognitos_automations_org_id ON kognitos_automations (org_id);

-- Stable UUID for seed / migration backfill (matches lib/seed-data).
-- org_id NULL until seed runs (organizations row may not exist at migrate time)
INSERT INTO kognitos_automations (id, automation_id, resource_name, display_name, description, org_id)
VALUES (
  'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  'seed-automation',
  'organizations/org-1/workspaces/ws-1/automations/seed-automation',
  'Seed automation',
  NULL,
  NULL
);

ALTER TABLE kognitos_runs
  ADD COLUMN kognitos_automation_id uuid REFERENCES kognitos_automations (id) ON DELETE CASCADE;

UPDATE kognitos_runs
SET kognitos_automation_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
WHERE kognitos_automation_id IS NULL;

ALTER TABLE kognitos_runs
  ALTER COLUMN kognitos_automation_id SET NOT NULL;

ALTER TABLE kognitos_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON kognitos_automations FOR SELECT USING (true);
