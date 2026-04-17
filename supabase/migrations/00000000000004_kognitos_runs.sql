-- Kognitos bridge: stored runs (raw API JSON) + denormalized file inputs per run.

CREATE TABLE kognitos_runs (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  create_time timestamptz,
  update_time timestamptz,
  inserted_at timestamptz DEFAULT now()
);

CREATE INDEX idx_kognitos_runs_create_time ON kognitos_runs (create_time DESC);

CREATE TABLE kognitos_run_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kognitos_run_id text NOT NULL
    REFERENCES kognitos_runs (id) ON DELETE CASCADE,
  input_key text NOT NULL,
  kognitos_file_id text NOT NULL DEFAULT '',
  file_name text,
  remote_raw text,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kognitos_run_id, input_key)
);

CREATE INDEX idx_kognitos_run_inputs_run_id ON kognitos_run_inputs (kognitos_run_id);

-- Placeholder runs so requests.kognitos_run_id FK and seed data resolve.
INSERT INTO kognitos_runs (id, name, payload, create_time, update_time) VALUES
(
  'run-1',
  'workspaces/ws-1/runs/run-1',
  jsonb_build_object(
    'name', 'workspaces/ws-1/runs/run-1',
    'createTime', '2026-02-20T09:00:00Z',
    'updateTime', '2026-02-20T09:04:32Z',
    'state', jsonb_build_object(
      'completed', jsonb_build_object(
        'outputs', jsonb_build_object('status', 'approved', 'reviewer_notes', 'Budget within limits', 'confidence_score', '85')
      )
    ),
    'stage', 'review-request',
    'stageVersion', '1.0',
    'invocationDetails', jsonb_build_object('invocationSource', 'api'),
    'userInputs', jsonb_build_object('request_id', 'req-4', 'title', 'Cloud Server Upgrade', 'category', 'equipment')
  ),
  '2026-02-20T09:00:00Z'::timestamptz,
  '2026-02-20T09:04:32Z'::timestamptz
),
(
  'run-2',
  'workspaces/ws-1/runs/run-2',
  jsonb_build_object(
    'name', 'workspaces/ws-1/runs/run-2',
    'createTime', '2026-02-21T14:30:00Z',
    'updateTime', '2026-02-21T14:33:15Z',
    'state', jsonb_build_object(
      'completed', jsonb_build_object(
        'outputs', jsonb_build_object('status', 'under_review', 'escalation_reason', 'Exceeds budget threshold', 'assigned_to', 'user-3')
      )
    ),
    'stage', 'escalate-request',
    'stageVersion', '1.0',
    'invocationDetails', jsonb_build_object('invocationSource', 'api'),
    'userInputs', jsonb_build_object('request_id', 'req-7', 'title', 'Annual Consulting Contract', 'category', 'consulting')
  ),
  '2026-02-21T14:30:00Z'::timestamptz,
  '2026-02-21T14:33:15Z'::timestamptz
),
(
  'run-3',
  'workspaces/ws-1/runs/run-3',
  jsonb_build_object(
    'name', 'workspaces/ws-1/runs/run-3',
    'createTime', '2026-02-10T10:00:00Z',
    'updateTime', '2026-02-15T11:00:00Z',
    'state', jsonb_build_object(
      'completed', jsonb_build_object('outputs', jsonb_build_object('status', 'under_review'))
    ),
    'stage', 'review-request',
    'stageVersion', '1.0',
    'invocationDetails', jsonb_build_object('invocationSource', 'api'),
    'userInputs', jsonb_build_object('request_id', 'req-6', 'title', 'Datadog APM upgrade', 'category', 'software')
  ),
  '2026-02-10T10:00:00Z'::timestamptz,
  '2026-02-15T11:00:00Z'::timestamptz
),
(
  'run-4',
  'workspaces/ws-1/runs/run-4',
  jsonb_build_object(
    'name', 'workspaces/ws-1/runs/run-4',
    'createTime', '2026-01-20T10:00:00Z',
    'updateTime', '2026-01-28T15:00:00Z',
    'state', jsonb_build_object(
      'completed', jsonb_build_object('outputs', jsonb_build_object('status', 'approved'))
    ),
    'stage', 'review-request',
    'stageVersion', '1.0',
    'invocationDetails', jsonb_build_object('invocationSource', 'api'),
    'userInputs', jsonb_build_object('request_id', 'req-9', 'title', 'AWS reserved instances', 'category', 'software')
  ),
  '2026-01-20T10:00:00Z'::timestamptz,
  '2026-01-28T15:00:00Z'::timestamptz
),
(
  'run-5',
  'workspaces/ws-1/runs/run-5',
  jsonb_build_object(
    'name', 'workspaces/ws-1/runs/run-5',
    'createTime', '2026-01-05T09:00:00Z',
    'updateTime', '2026-01-15T10:00:00Z',
    'state', jsonb_build_object(
      'completed', jsonb_build_object('outputs', jsonb_build_object('status', 'closed'))
    ),
    'stage', 'review-request',
    'stageVersion', '1.0',
    'invocationDetails', jsonb_build_object('invocationSource', 'api'),
    'userInputs', jsonb_build_object('request_id', 'req-14', 'title', 'New laptop provisioning', 'category', 'equipment')
  ),
  '2026-01-05T09:00:00Z'::timestamptz,
  '2026-01-15T10:00:00Z'::timestamptz
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE requests
  ADD CONSTRAINT requests_kognitos_run_fkey
  FOREIGN KEY (kognitos_run_id) REFERENCES kognitos_runs (id) ON DELETE SET NULL;

ALTER TABLE kognitos_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kognitos_run_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON kognitos_runs FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON kognitos_run_inputs FOR SELECT USING (true);
