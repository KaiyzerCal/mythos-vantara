-- Extends the nightly mavis-data-retention cron job (20260612000002) to
-- cover four more unbounded tables added since: mavis_agent_messages,
-- mavis_agent_memories, mavis_crew_progress, mavis_plugin_executions.
-- cron.schedule() with an existing job name updates it in place, so this
-- redefines the full job body (original statements + the new ones).

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

  -- Agent-to-agent message bus (A2A protocol) — short-lived by design
  -- (default ttl_ms 5 min via expires_at). Clear anything already expired,
  -- plus a 30-day safety net for rows that never got an expires_at set.
  DELETE FROM public.mavis_agent_messages
  WHERE (
      (expires_at IS NOT NULL AND expires_at < now())
      OR created_at < now() - interval '30 days'
    )
    AND ctid IN (
      SELECT ctid FROM public.mavis_agent_messages
      WHERE (expires_at IS NOT NULL AND expires_at < now())
         OR created_at < now() - interval '30 days'
      LIMIT 2000
    );

  -- Long-term agent memory store (mirrors mavis_persona_memory's pattern) —
  -- only remove memories already marked archived/superseded, never 'active'
  -- ones, since this is designed as durable knowledge, not a log.
  DELETE FROM public.mavis_agent_memories
  WHERE status IN ('archived', 'superseded')
    AND updated_at < now() - interval '180 days'
    AND ctid IN (
      SELECT ctid FROM public.mavis_agent_memories
      WHERE status IN ('archived', 'superseded')
        AND updated_at < now() - interval '180 days'
      LIMIT 2000
    );

  -- Per-run progress event log for the crew orchestrator's live-streaming
  -- UI — purely transient, safe to clear once a run is well past relevant.
  DELETE FROM public.mavis_crew_progress
  WHERE created_at < now() - interval '14 days'
    AND ctid IN (
      SELECT ctid FROM public.mavis_crew_progress
      WHERE created_at < now() - interval '14 days'
      LIMIT 5000
    );

  -- Plugin execution log — observability/debugging trail, moderate retention.
  DELETE FROM public.mavis_plugin_executions
  WHERE created_at < now() - interval '60 days'
    AND ctid IN (
      SELECT ctid FROM public.mavis_plugin_executions
      WHERE created_at < now() - interval '60 days'
      LIMIT 2000
    );
  $cron_body$
);
