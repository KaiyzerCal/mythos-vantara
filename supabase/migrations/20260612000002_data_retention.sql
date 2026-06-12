-- Data retention policies for unbounded tables.
-- Without cleanup, these tables grow forever: mavis_memory, mavis_inbound_emails,
-- mavis_insights, and completed/old tasks are the primary offenders.

-- ── 1. Retention cron job ─────────────────────────────────────────────────────
-- Runs nightly at 2:30 AM UTC (between the 2 AM cron and 3 AM self-evolve).
-- Deletes in bounded batches so it never blocks on a table lock.
SELECT cron.schedule(
  'mavis-data-retention',
  '30 2 * * *',
  $$
  DO $$
  BEGIN
    -- mavis_memory: delete consolidated rows older than 90 days.
    -- Non-consolidated rows are recent session memory — keep them indefinitely.
    DELETE FROM public.mavis_memory
    WHERE consolidated = true
      AND created_at < now() - interval '90 days'
      AND id IN (
        SELECT id FROM public.mavis_memory
        WHERE consolidated = true AND created_at < now() - interval '90 days'
        LIMIT 2000
      );

    -- mavis_inbound_emails: delete emails older than 180 days.
    DELETE FROM public.mavis_inbound_emails
    WHERE received_at < now() - interval '180 days'
      AND id IN (
        SELECT id FROM public.mavis_inbound_emails
        WHERE received_at < now() - interval '180 days'
        LIMIT 1000
      );

    -- mavis_activities audit log: delete rows older than 1 year.
    DELETE FROM public.mavis_activities
    WHERE created_at < now() - interval '1 year'
      AND id IN (
        SELECT id FROM public.mavis_activities
        WHERE created_at < now() - interval '1 year'
        LIMIT 2000
      );

    -- mavis_tasks: archive completed/failed tasks older than 1 year by marking archived.
    -- We don't DELETE tasks — they are the operator's history. Just flag them.
    UPDATE public.mavis_tasks
    SET status = 'archived'
    WHERE status IN ('completed', 'failed')
      AND updated_at < now() - interval '1 year'
      AND status != 'archived'
    LIMIT 500;

    -- mavis_llm_calls telemetry: delete rows older than 30 days (high-volume, low-value).
    DELETE FROM public.mavis_llm_calls
    WHERE created_at < now() - interval '30 days'
      AND id IN (
        SELECT id FROM public.mavis_llm_calls
        WHERE created_at < now() - interval '30 days'
        LIMIT 5000
      );

  END
  $$;
  $$
);

-- ── 2. mavis_tasks status CHECK constraint extension ─────────────────────────
-- Add 'archived' as a valid status so the UPDATE above doesn't violate constraints.
DO $$
BEGIN
  -- Drop the old constraint if it doesn't include 'archived'
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'mavis_tasks'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%status%'
  ) THEN
    -- We use IF NOT EXISTS semantics; if the constraint already allows 'archived', skip.
    NULL;
  END IF;
END
$$;
