-- Extend mavis_plans with summary and text context (plan_execute migration adds jsonb context)
ALTER TABLE mavis_plans
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Allow context to hold plain text as well (cast existing jsonb to text-compatible via new column if needed)
-- We add a separate text column for plain-text context from mavis-planner
ALTER TABLE mavis_plans
  ADD COLUMN IF NOT EXISTS context_text text;

-- Extend mavis_plan_steps with phase and step_order used by mavis-planner
ALTER TABLE mavis_plan_steps
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS step_order int,
  ADD COLUMN IF NOT EXISTS estimated_minutes int DEFAULT 30,
  ADD COLUMN IF NOT EXISTS quest_id uuid;

CREATE INDEX IF NOT EXISTS idx_mavis_plan_steps_plan_id ON mavis_plan_steps(plan_id);
