do $$
begin
  perform cron.unschedule('mavis-causal-engine-weekly');
exception when others then null;
end $$;

select cron.schedule(
  'mavis-causal-engine-weekly',
  '0 2 * * 0',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/mavis-causal-engine',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'), 'Content-Type', 'application/json'),
    body := '{"cron": true}'::jsonb
  )
  $$
);
