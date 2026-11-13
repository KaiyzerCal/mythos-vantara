-- Read-only system health snapshot for the in-app System Health page: failing scheduled jobs, AI providers on cool-down,
-- and failing outbound calls from the database. Until now these were only reachable by querying the database by hand,
-- which is how three nightly jobs went unnoticed.
-- Operator-only (the first account); everyone else gets {"error":"forbidden"}. Messages are truncated and carry no secrets.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.mavis_system_health() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  operator_id uuid;
  cron_failures jsonb := '[]'::jsonb;
  cron_totals jsonb := '{}'::jsonb;
  providers jsonb := '[]'::jsonb;
  http_errors jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO operator_id FROM public.profiles ORDER BY created_at ASC LIMIT 1;
  IF auth.uid() IS NULL OR operator_id IS NULL OR auth.uid() <> operator_id THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  BEGIN
    SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO cron_failures FROM (
      SELECT j.jobname AS job,
             count(*) FILTER (WHERE d.status = 'failed') AS failed,
             count(*) AS runs,
             max(d.start_time) FILTER (WHERE d.status = 'failed') AS last_failure,
             left(max(d.return_message) FILTER (WHERE d.status = 'failed'), 160) AS message
      FROM cron.job j JOIN cron.job_run_details d ON d.jobid = j.jobid
      WHERE d.start_time > now() - interval '24 hours'
      GROUP BY j.jobname
      HAVING count(*) FILTER (WHERE d.status = 'failed') > 0
      ORDER BY 2 DESC LIMIT 25) t;
    SELECT jsonb_build_object(
      'jobs', (SELECT count(*) FROM cron.job WHERE active),
      'runs_24h', count(*), 'failed_24h', count(*) FILTER (WHERE status = 'failed'))
    INTO cron_totals FROM cron.job_run_details WHERE start_time > now() - interval '24 hours';
  EXCEPTION WHEN others THEN cron_failures := jsonb_build_array(jsonb_build_object('job', '(cron unavailable)', 'message', left(SQLERRM, 160)));
  END;

  BEGIN
    SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO providers FROM (
      SELECT provider, unhealthy_until, left(reason, 160) AS reason
      FROM public.mavis_provider_health WHERE unhealthy_until > now() ORDER BY provider) t;
  EXCEPTION WHEN others THEN providers := '[]'::jsonb;
  END;

  BEGIN
    SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO http_errors FROM (
      SELECT status_code, count(*) AS n FROM net._http_response
      WHERE created > now() - interval '24 hours' AND status_code >= 400
      GROUP BY status_code ORDER BY n DESC LIMIT 10) t;
  EXCEPTION WHEN others THEN http_errors := '[]'::jsonb;
  END;

  RETURN jsonb_build_object('generated_at', now(), 'cron_totals', cron_totals, 'cron_failures', cron_failures,
                            'providers_cooling_down', providers, 'http_errors_24h', http_errors);
END $$;
REVOKE ALL ON FUNCTION public.mavis_system_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mavis_system_health() TO authenticated;
