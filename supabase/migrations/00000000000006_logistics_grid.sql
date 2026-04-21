-- Logistics page: persisted grid rows (single-tenant document).

CREATE TABLE logistics_grid_state (
  id text PRIMARY KEY,
  rows jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_grid_state_updated ON logistics_grid_state (updated_at DESC);

ALTER TABLE logistics_grid_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON logistics_grid_state FOR SELECT USING (true);
