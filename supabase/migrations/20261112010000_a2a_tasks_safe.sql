-- mavis_a2a_tasks was defined in 20260618000009 but never reached the live database (the AgentDashboard A2A tab and
-- mavis-a2a inserts fail without it). That file declares user_id REFERENCES auth.users(id), the line that took auth
-- down on 2026-08-22, so it is not applied as written. This is the same table without the FK (ownership is enforced
-- by the RLS policy), with lock_timeout, and safe to run twice.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mavis_a2a_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  session_id text,
  calling_agent_url text,
  skill_id text NOT NULL,
  input jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result jsonb,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.mavis_a2a_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "a2a_tasks_user" ON public.mavis_a2a_tasks FOR ALL
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS mavis_a2a_tasks_user_status_idx ON public.mavis_a2a_tasks (user_id, status, created_at DESC);
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mavis_a2a_tasks;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
