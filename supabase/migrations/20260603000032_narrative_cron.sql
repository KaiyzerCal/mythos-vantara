DO $$ BEGIN PERFORM cron.unschedule('mavis-narrative-engine'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule(
  'mavis-narrative-engine',
  '0 4 * * 0',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-narrative-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object('cron', true)
  )
  $$
);
