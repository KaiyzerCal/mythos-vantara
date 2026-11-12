-- Keep the Calendar tab fresh: mavis-calendar-sync now accepts the service key (acting as the operator), so it can run on a
-- schedule like the Gmail sync (every 15 min). Calendar changes less often and the call is cheap (no AI), so every 30.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

SELECT cron.schedule('mavis-calendar-sync-30m', '*/30 * * * *', $c$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-calendar-sync',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{"days_ahead":90}'::jsonb, timeout_milliseconds := 60000);
$c$);
