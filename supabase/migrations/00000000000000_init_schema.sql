-- Workflow Template: Approval Requests Schema

-- ── Enums ──────────────────────────────────────────────────────
CREATE TYPE request_status AS ENUM ('draft','submitted','under_review','approved','rejected','closed');
CREATE TYPE user_role AS ENUM ('requester','reviewer','manager','admin');
CREATE TYPE priority AS ENUM ('urgent','standard');

-- ── Tables (dependency order) ──────────────────────────────────

CREATE TABLE organizations (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, created_at timestamptz DEFAULT now());

CREATE TABLE users (id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id), full_name text NOT NULL, email text NOT NULL, role user_role NOT NULL, avatar_url text, created_at timestamptz DEFAULT now());

CREATE TABLE requests (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  title text NOT NULL,
  description text,
  requester_id text NOT NULL REFERENCES users(id),
  assigned_to text REFERENCES users(id),
  status request_status NOT NULL DEFAULT 'draft',
  priority priority NOT NULL DEFAULT 'standard',
  category text NOT NULL,
  estimated_value numeric(12,2) DEFAULT 0,
  submitted_at timestamptz,
  decided_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  kognitos_run_id text,
  episode_id text
);

CREATE TABLE documents (id text PRIMARY KEY, request_id text NOT NULL REFERENCES requests(id), file_name text NOT NULL, document_type text NOT NULL, size_bytes integer DEFAULT 0, source text DEFAULT 'manual_upload', created_at timestamptz DEFAULT now());

CREATE TABLE comments (id text PRIMARY KEY, request_id text NOT NULL REFERENCES requests(id), author_id text NOT NULL REFERENCES users(id), content text NOT NULL, created_at timestamptz DEFAULT now());

CREATE TABLE audit_events (id text PRIMARY KEY, request_id text NOT NULL REFERENCES requests(id), action text NOT NULL, actor_id text, details jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());

CREATE TABLE notifications (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), request_id text REFERENCES requests(id), message text NOT NULL, is_read boolean DEFAULT false, created_at timestamptz DEFAULT now());

CREATE TABLE rules (id text PRIMARY KEY, name text NOT NULL, description text, category text, is_active boolean DEFAULT true, criteria text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_assigned ON requests(assigned_to);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_audit_events_request ON audit_events(request_id);

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON organizations FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON users FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON requests FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON documents FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON comments FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON audit_events FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON notifications FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON rules FOR SELECT USING (true);
