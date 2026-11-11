-- Game layer (mavis-fun-engine): milestone ledger + three schedules.
-- mavis_beats is read/written only by the edge function (service role); RLS on, no policies.
-- No foreign key to auth.users on purpose (see CLAUDE.md "Database Changes").
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mavis_beats (
  user_id    uuid        NOT NULL,
  key        text        NOT NULL,
  kind       text        NOT NULL,
  text       text,
  announced  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
ALTER TABLE public.mavis_beats ENABLE ROW LEVEL SECURITY;

INSERT INTO public.mavis_smoke_targets(name) VALUES ('mavis-fun-engine') ON CONFLICT DO NOTHING;

-- chapter: Sundays 21:07 UTC. boss: daily 11:20 UTC (after the 11:00 morning brief). beat: every 2h (no AI call
-- unless a new milestone exists).
SELECT cron.schedule('mavis-fun-chapter-weekly', '7 21 * * 0', $c$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-fun-engine',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{"mode":"chapter"}'::jsonb, timeout_milliseconds := 120000);
$c$);
SELECT cron.schedule('mavis-fun-boss-daily', '20 11 * * *', $c$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-fun-engine',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{"mode":"boss"}'::jsonb, timeout_milliseconds := 120000);
$c$);
SELECT cron.schedule('mavis-fun-beat-2h', '40 */2 * * *', $c$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-fun-engine',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{"mode":"beat"}'::jsonb, timeout_milliseconds := 120000);
$c$);
