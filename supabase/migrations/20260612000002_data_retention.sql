-- Data retention policies for unbounded tables.
-- Without cleanup, these tables grow forever: mavis_memory, mavis_inbound_emails,
-- mavis_activities, and llm call logs are the primary offenders.

-- ── 1. Retention cron job (nightly SQL DELETE) ───────────────────────────────
-- Runs nightly at 2:30 AM UTC. Uses single-quoted SQL string to avoid
-- dollar-quoting conflicts with the outer cron.schedule call.
SELECT cron.schedule(
  'mavis-data-retention',
  '30 2 * * *',
  $cron_body$
  DELETE FROM public.mavis_memory
  WHERE consolidated = true
    AND created_at < now() - interval '90 days'
    AND ctid IN (
      SELECT ctid FROM public.mavis_memory
      WHERE consolidated = true AND created_at < now() - interval '90 days'
      LIMIT 2000
    );

  DELETE FROM public.mavis_inbound_emails
  WHERE received_at < now() - interval '180 days'
    AND ctid IN (
      SELECT ctid FROM public.mavis_inbound_emails
      WHERE received_at < now() - interval '180 days'
      LIMIT 1000
    );

  DELETE FROM public.mavis_activities
  WHERE created_at < now() - interval '1 year'
    AND ctid IN (
      SELECT ctid FROM public.mavis_activities
      WHERE created_at < now() - interval '1 year'
      LIMIT 2000
    );

  DELETE FROM public.mavis_llm_calls
  WHERE created_at < now() - interval '30 days'
    AND ctid IN (
      SELECT ctid FROM public.mavis_llm_calls
      WHERE created_at < now() - interval '30 days'
      LIMIT 5000
    );

  DELETE FROM public.mavis_persona_memory
  WHERE consolidated = true
    AND created_at < now() - interval '60 days'
    AND ctid IN (
      SELECT ctid FROM public.mavis_persona_memory
      WHERE consolidated = true AND created_at < now() - interval '60 days'
      LIMIT 2000
    );

  UPDATE public.mavis_tasks
  SET status = 'archived'
  WHERE status IN ('completed', 'failed')
    AND updated_at < now() - interval '1 year'
    AND ctid IN (
      SELECT ctid FROM public.mavis_tasks
      WHERE status IN ('completed', 'failed')
        AND updated_at < now() - interval '1 year'
      LIMIT 500
    );
  $cron_body$
);
