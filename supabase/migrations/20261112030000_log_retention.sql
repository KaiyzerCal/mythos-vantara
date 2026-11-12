-- Retention for two pure log tables that only ever grew (about 290 rows a day each; ~24k and ~28k rows, most older
-- than 14 days). Nothing reads them past recent history. Runs daily inside the database, no HTTP hop.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.mavis_prune_logs() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a int; b int;
BEGIN
  DELETE FROM public.mavis_autonomous_runs WHERE triggered_at < now() - interval '14 days';
  GET DIAGNOSTICS a = ROW_COUNT;
  DELETE FROM public.mavis_ambient_events WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS b = ROW_COUNT;
  RETURN jsonb_build_object('autonomous_runs', a, 'ambient_events', b);
END $$;
REVOKE ALL ON FUNCTION public.mavis_prune_logs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mavis_prune_logs() TO service_role;

SELECT cron.schedule('mavis-log-prune-daily', '25 4 * * *', $c$ SELECT public.mavis_prune_logs(); $c$);
