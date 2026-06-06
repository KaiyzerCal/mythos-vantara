DO $$ BEGIN PERFORM cron.unschedule('mavis-world-model'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule(
  'mavis-world-model',
  '0 5 * * 0',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-world-model',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object('cron', true)
  )
  $$
);
