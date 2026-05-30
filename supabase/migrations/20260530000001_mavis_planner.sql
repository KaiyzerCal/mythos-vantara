-- Extend mavis_plans with columns used by the mavis-planner edge function
ALTER TABLE mavis_plans
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Extend mavis_plan_steps with phase-based planning columns used by mavis-planner
ALTER TABLE mavis_plan_steps
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS step_order int,
  ADD COLUMN IF NOT EXISTS estimated_minutes int DEFAULT 30,
  ADD COLUMN IF NOT EXISTS quest_id uuid;

CREATE INDEX IF NOT EXISTS idx_mavis_plan_steps_plan_id ON mavis_plan_steps(plan_id);
