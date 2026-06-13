DO $$ BEGIN PERFORM cron.unschedule('mavis-relationship-intel'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule(
  'mavis-relationship-intel',
  '0 8 * * 1',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-relationship-intel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object('cron', true)
  )
  $$
);
