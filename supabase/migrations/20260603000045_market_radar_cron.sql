DO $$ BEGIN PERFORM cron.unschedule('mavis-market-radar-daily'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('mavis-market-radar-daily', '30 6 * * *',
  $$SELECT net.http_post(url:='https://' || (SELECT value FROM vault.secrets WHERE name='project_ref') || '.supabase.co/functions/v1/mavis-market-radar', headers:='{"Content-Type":"application/json","Authorization":"Bearer ' || (SELECT value FROM vault.secrets WHERE name='service_role_key') || '"}'::jsonb, body:='{"cron":true}'::jsonb) AS request_id$$
);
