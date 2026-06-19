-- mavis_eval_scores: weekly agent quality rubric scores
-- Extensions (may already exist)
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron;  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net;   EXCEPTION WHEN others THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS mavis_eval_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  rubric text NOT NULL CHECK (rubric IN ('relevance', 'accuracy', 'action_correctness', 'calibration', 'tone')),
  score numeric(4,2) NOT NULL,
  delta numeric(4,2),
  sample_size int,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, week_start, rubric)
);

ALTER TABLE mavis_eval_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eval_scores_user" ON mavis_eval_scores
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for history queries
CREATE INDEX IF NOT EXISTS mavis_eval_scores_user_week_idx
  ON mavis_eval_scores (user_id, week_start DESC);

-- Weekly evaluation cron: every Saturday at 2 AM UTC
DO $$ BEGIN PERFORM cron.unschedule('mavis-weekly-eval'); EXCEPTION WHEN others THEN NULL; END $$;

SELECT cron.schedule(
  'mavis-weekly-eval',
  '0 2 * * 6',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-eval',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := jsonb_build_object('action', 'evaluate_conversations')
  ) AS request_id
  $$
);
