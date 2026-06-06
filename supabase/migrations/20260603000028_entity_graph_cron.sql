DO $$ BEGIN PERFORM cron.unschedule('mavis-entity-graph'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule(
  'mavis-entity-graph',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-entity-graph',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object('action', 'build', 'cron', true)
  )
  $$
);
