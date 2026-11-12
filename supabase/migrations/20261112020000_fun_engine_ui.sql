-- Game layer, part 2: the app can read its own beats (the Dashboard Story card), chapters get the lowercase
-- Vault category the app uses, the boss moves ahead of the morning brief, and status effects get a schedule.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

DO $$ BEGIN
  CREATE POLICY "mavis_beats_own_read" ON public.mavis_beats FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.vault_entries SET category = 'chapter' WHERE category = 'Chapter';

-- Boss at 10:50 UTC so the 11:00 brief can show it; status effects every 6h.
SELECT cron.schedule('mavis-fun-boss-daily', '50 10 * * *', $c$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-fun-engine',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{"mode":"boss"}'::jsonb, timeout_milliseconds := 120000);
$c$);
SELECT cron.schedule('mavis-fun-status-6h', '50 */6 * * *', $c$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-fun-engine',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{"mode":"status"}'::jsonb, timeout_milliseconds := 120000);
$c$);
