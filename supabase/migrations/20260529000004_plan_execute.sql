-- Plan-and-Execute agent: stores goal DAGs decomposed by the planner

CREATE TABLE IF NOT EXISTS mavis_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  goal         text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused','failed')),
  total_steps  int  NOT NULL DEFAULT 0,
  done_steps   int  NOT NULL DEFAULT 0,
  context      jsonb,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mavis_plan_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid NOT NULL REFERENCES mavis_plans(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_index   int  NOT NULL,
  title        text NOT NULL,
  description  text,
  type         text NOT NULL DEFAULT 'execute' CHECK (type IN ('research','write','execute','create_quest','notify','wait')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
  depends_on   uuid[], -- IDs of steps that must complete first
  result       text,
  error        text,
  actions      jsonb, -- MAVIS actions to execute for this step
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE mavis_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mavis_plan_steps  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own plans"      ON mavis_plans      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own plan steps" ON mavis_plan_steps FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS plan_steps_plan_idx   ON mavis_plan_steps (plan_id, step_index);
CREATE INDEX IF NOT EXISTS plan_steps_status_idx ON mavis_plan_steps (user_id, status);
