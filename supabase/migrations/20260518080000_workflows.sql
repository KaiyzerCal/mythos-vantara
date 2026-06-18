CREATE TABLE IF NOT EXISTS workflows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  trigger_type text DEFAULT 'manual',
  trigger_config jsonb DEFAULT '{}',
  steps jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  last_run_at timestamptz,
  last_run_status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='workflows' AND policyname='workflows_owner') THEN
    CREATE POLICY workflows_owner ON workflows FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status text DEFAULT 'running',
  steps_log jsonb DEFAULT '[]',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='workflow_runs' AND policyname='workflow_runs_owner') THEN
    CREATE POLICY workflow_runs_owner ON workflow_runs FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;
