-- Crew orchestrator: incremental per-agent persistence
--
-- mavis-crew-orchestrator only wrote to mavis_crew_runs once, at the very
-- end (after decomposition + all agents + synthesis + validation all
-- succeeded). If the function hung or was killed partway through — most
-- commonly because a single agent's Claude fetch call had no timeout and
-- could hang indefinitely — every already-completed agent's output was
-- lost with nothing durable to show for it, only the ephemeral
-- mavis_crew_progress event log (capped at 1000 chars per event, not
-- meant as the durable record).
--
-- Adds run_id (correlates with the run_id already used for
-- mavis_crew_progress) and status, and an atomic append function so each
-- agent's result is persisted the moment it finishes, not batched at the
-- end.

ALTER TABLE mavis_crew_runs ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE mavis_crew_runs ADD COLUMN IF NOT EXISTS status text DEFAULT 'running';

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_mavis_crew_runs_run_id ON mavis_crew_runs (run_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Atomically appends one agent's result to an in-progress run's
-- agent_results array. SECURITY DEFINER + explicit user_id check (rather
-- than relying on RLS auth.uid()) since this is called from the edge
-- function's service-role client, which has no authenticated user context
-- of its own — the caller passes the user_id it already validated the
-- request under.
CREATE OR REPLACE FUNCTION public.append_crew_agent_result(
  p_run_id uuid,
  p_user_id uuid,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE mavis_crew_runs
  SET agent_results = agent_results || jsonb_build_array(p_result)
  WHERE run_id = p_run_id AND user_id = p_user_id;
END;
$$;
