-- A2A protocol task queue
CREATE TABLE IF NOT EXISTS a2a_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  external_agent_id text,
  skill_id text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  input_message text NOT NULL,
  output_message text,
  artifacts jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE a2a_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own a2a tasks" ON a2a_tasks FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_a2a_tasks_user ON a2a_tasks(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Code delegation sessions (Devin/Cursor)
CREATE TABLE IF NOT EXISTS code_delegation_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  provider text NOT NULL DEFAULT 'devin',
  external_session_id text,
  task_description text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  session_url text,
  prs_created jsonb DEFAULT '[]',
  messages jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE code_delegation_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own code sessions" ON code_delegation_sessions FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Computer use task log
CREATE TABLE IF NOT EXISTS computer_use_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  task_description text NOT NULL,
  model text NOT NULL DEFAULT 'computer-use-preview',
  actions_taken jsonb DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  result text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE computer_use_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own computer use" ON computer_use_tasks FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
