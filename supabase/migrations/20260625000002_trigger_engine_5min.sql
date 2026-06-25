-- Reschedule mavis-trigger-engine from every 10 minutes to every 5 minutes.
-- Unschedule the old 10-minute job and replace with a 5-minute job.
SELECT cron.unschedule('mavis-trigger-engine-10m');

DO $$
DECLARE
  v_url  TEXT;
  v_key  TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL'          LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY'      LIMIT 1;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM cron.schedule(
      'mavis-trigger-engine-5m',
      '*/5 * * * *',
      format(
        $cron$
        SELECT net.http_post(
          url     := %L || '/functions/v1/mavis-trigger-engine',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
          body    := '{"action":"run"}'::jsonb
        );
        $cron$,
        v_url, v_key
      )
    );
  END IF;
END;
$$;
