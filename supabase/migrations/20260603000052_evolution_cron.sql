DO $$ BEGIN PERFORM cron.unschedule('mavis-self-evolve-weekly'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('mavis-self-evolve-weekly', '0 3 * * 0',
  $$SELECT net.http_post(url:='https://' || (SELECT value FROM vault.secrets WHERE name='project_ref') || '.supabase.co/functions/v1/mavis-self-evolve', headers:='{"Content-Type":"application/json","Authorization":"Bearer ' || (SELECT value FROM vault.secrets WHERE name='service_role_key') || '"}'::jsonb, body:='{"cron":true}'::jsonb) AS request_id$$
);
