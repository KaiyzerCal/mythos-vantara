-- Three nightly jobs were failing in production (cron.job_run_details, last 24h):
--   mavis-data-retention        ERROR: column "updated_at" does not exist  (one of its tables has no such column)
--   mavis-market-radar-daily    ERROR: column "value" does not exist       (reads vault.secrets.value; the column is decrypted_secret)
--   mavis-outcome-tracker-daily same as above
-- Re-runnable. Every statement is guarded; nothing here touches app data until the retention function is called.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ── Retention: one function that checks each table/column exists before it deletes. A schema drift in one table now
-- skips that table (and says so in the result) instead of aborting the whole job and leaving every table to grow.
CREATE OR REPLACE FUNCTION public.mavis_data_retention() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- table, time column, age, extra condition, row cap per run — the same rules as 20260804070000_extend_data_retention.sql
  spec jsonb := '[
    ["mavis_memory",            "created_at",  "90 days",  "consolidated = true",                                   2000],
    ["mavis_inbound_emails",    "received_at", "180 days", "true",                                                  1000],
    ["mavis_activities",        "created_at",  "1 year",   "true",                                                  2000],
    ["mavis_llm_calls",         "created_at",  "30 days",  "true",                                                  5000],
    ["mavis_persona_memory",    "created_at",  "60 days",  "consolidated = true",                                   2000],
    ["mavis_crew_progress",     "created_at",  "14 days",  "true",                                                  5000],
    ["mavis_plugin_executions", "created_at",  "60 days",  "true",                                                  2000]
  ]'::jsonb;
  r jsonb; tbl text; col text; age text; extra text; cap int; n int;
  result jsonb := '{}'::jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(spec) LOOP
    tbl := r->>0; col := r->>1; age := r->>2; extra := r->>3; cap := (r->>4)::int;
    IF to_regclass('public.' || tbl) IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=tbl AND column_name=col) THEN
      result := result || jsonb_build_object(tbl, 'skipped: table or column missing');
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE %s AND %I < now() - $1::interval AND ctid IN (SELECT ctid FROM public.%I WHERE %s AND %I < now() - $1::interval LIMIT %s)',
                     tbl, extra, col, tbl, extra, col, cap) USING age;
      GET DIAGNOSTICS n = ROW_COUNT;
      result := result || jsonb_build_object(tbl, n);
    EXCEPTION WHEN others THEN
      result := result || jsonb_build_object(tbl, 'skipped: ' || SQLERRM);
    END;
  END LOOP;

  -- A2A message bus: expired rows, plus a 30-day safety net.
  IF to_regclass('public.mavis_agent_messages') IS NOT NULL
     AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='mavis_agent_messages' AND column_name IN ('expires_at','created_at')) = 2 THEN
    BEGIN
      DELETE FROM public.mavis_agent_messages WHERE ctid IN (
        SELECT ctid FROM public.mavis_agent_messages
        WHERE (expires_at IS NOT NULL AND expires_at < now()) OR created_at < now() - interval '30 days' LIMIT 2000);
      GET DIAGNOSTICS n = ROW_COUNT;
      result := result || jsonb_build_object('mavis_agent_messages', n);
    EXCEPTION WHEN others THEN result := result || jsonb_build_object('mavis_agent_messages', 'skipped: ' || SQLERRM); END;
  END IF;

  -- Agent memories: only already archived/superseded ones. Falls back to created_at when updated_at is missing.
  IF to_regclass('public.mavis_agent_memories') IS NOT NULL THEN
    BEGIN
      col := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mavis_agent_memories' AND column_name='updated_at')
                  THEN 'updated_at' ELSE 'created_at' END;
      EXECUTE format('DELETE FROM public.mavis_agent_memories WHERE ctid IN (SELECT ctid FROM public.mavis_agent_memories WHERE status IN (''archived'',''superseded'') AND %I < now() - interval ''180 days'' LIMIT 2000)', col);
      GET DIAGNOSTICS n = ROW_COUNT;
      result := result || jsonb_build_object('mavis_agent_memories', n);
    EXCEPTION WHEN others THEN result := result || jsonb_build_object('mavis_agent_memories', 'skipped: ' || SQLERRM); END;
  END IF;

  -- Old finished tasks are archived, not deleted.
  IF to_regclass('public.mavis_tasks') IS NOT NULL THEN
    BEGIN
      col := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mavis_tasks' AND column_name='updated_at')
                  THEN 'updated_at' ELSE 'created_at' END;
      EXECUTE format('UPDATE public.mavis_tasks SET status = ''archived'' WHERE ctid IN (SELECT ctid FROM public.mavis_tasks WHERE status IN (''completed'',''failed'') AND %I < now() - interval ''1 year'' LIMIT 500)', col);
      GET DIAGNOSTICS n = ROW_COUNT;
      result := result || jsonb_build_object('mavis_tasks_archived', n);
    EXCEPTION WHEN others THEN result := result || jsonb_build_object('mavis_tasks_archived', 'skipped: ' || SQLERRM); END;
  END IF;

  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mavis_data_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mavis_data_retention() TO service_role;

-- ── The two HTTP jobs: same schedule, working secret lookup (the pattern mavis-calendar-sync-30m already uses).
SELECT cron.schedule('mavis-market-radar-daily', '30 6 * * *', $c$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-market-radar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$c$);

SELECT cron.schedule('mavis-outcome-tracker-daily', '0 21 * * *', $c$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-outcome-tracker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$c$);

-- Last: point the retention job at the guarded function. Applied only after the function has been called once by hand
-- and its result checked (see the rollout notes in the PR).
SELECT cron.schedule('mavis-data-retention', '30 2 * * *', $c$ SELECT public.mavis_data_retention(); $c$);
