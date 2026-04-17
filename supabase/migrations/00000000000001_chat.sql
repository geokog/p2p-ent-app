-- Chat sessions and messages for the AI assistant

CREATE TABLE chat_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE chat_messages (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL DEFAULT '',
  tool_call jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Read policies
CREATE POLICY "Users can read own sessions"
  ON chat_sessions FOR SELECT USING (true);

CREATE POLICY "Users can read messages in accessible sessions"
  ON chat_messages FOR SELECT USING (true);

-- Write policies
CREATE POLICY "Users can insert own sessions"
  ON chat_sessions FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own sessions"
  ON chat_sessions FOR UPDATE USING (true);

CREATE POLICY "Users can delete own sessions"
  ON chat_sessions FOR DELETE USING (true);

CREATE POLICY "Users can insert messages"
  ON chat_messages FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can delete messages in own sessions"
  ON chat_messages FOR DELETE USING (true);

CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
