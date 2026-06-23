-- Schedule performance science engine at 7:05am daily (after morning brief at 6am)
do $$
begin
  perform cron.unschedule('mavis-performance-science-daily');
exception when others then null;
end $$;

select cron.schedule(
  'mavis-performance-science-daily',
  '5 7 * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/mavis-performance-science',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'), 'Content-Type', 'application/json'),
    body := '{"cron": true}'::jsonb
  )
  $$
);
