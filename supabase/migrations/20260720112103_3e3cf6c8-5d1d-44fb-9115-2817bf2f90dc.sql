CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.gmail_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gmail_id       TEXT NOT NULL,
  thread_id      TEXT,
  from_address   TEXT,
  to_addresses   TEXT[],
  subject        TEXT,
  snippet        TEXT,
  body_text      TEXT,
  body_html      TEXT,
  labels         TEXT[],
  received_at    TIMESTAMPTZ,
  is_read        BOOLEAN NOT NULL DEFAULT false,
  processed      BOOLEAN NOT NULL DEFAULT false,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, gmail_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_messages TO authenticated;
GRANT ALL ON public.gmail_messages TO service_role;

ALTER TABLE public.gmail_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gmail_messages_owner_all" ON public.gmail_messages;
CREATE POLICY "gmail_messages_owner_all"
  ON public.gmail_messages
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_gmail_messages_updated_at ON public.gmail_messages;
CREATE TRIGGER trg_gmail_messages_updated_at
  BEFORE UPDATE ON public.gmail_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_gmail_messages_user_received
  ON public.gmail_messages (user_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.cron_schedule(p_jobname TEXT, p_schedule TEXT, p_command TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE jid BIGINT;
BEGIN
  PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = p_jobname;
  SELECT cron.schedule(p_jobname, p_schedule, p_command) INTO jid;
  RETURN jid;
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_unschedule(p_jobname TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = p_jobname;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_schedule(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_unschedule(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_schedule(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_unschedule(TEXT) TO service_role;

DO $$
DECLARE
  base_url  TEXT := 'https://wlygujlvsfimhtqsdxrx.supabase.co/functions/v1/';
  anon_key  TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndseWd1amx2c2ZpbWh0cXNkeHJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNTE3MDEsImV4cCI6MjA4OTcyNzcwMX0.ytHCLaHt2qn5s4sGzrbxI6Bj5H9eacln7pDmU7SYl5A';
  jobs JSONB := '[
    {"name":"mavis-heartbeat",          "schedule":"*/5 * * * *",  "fn":"mavis-heartbeat"},
    {"name":"mavis-autonomous-engine",  "schedule":"*/5 * * * *",  "fn":"mavis-autonomous-engine"},
    {"name":"mavis-so-scheduler",       "schedule":"*/15 * * * *", "fn":"mavis-so-scheduler"},
    {"name":"mavis-trigger-engine",     "schedule":"*/10 * * * *", "fn":"mavis-trigger-engine"},
    {"name":"mavis-gmail-sync",         "schedule":"*/15 * * * *", "fn":"mavis-gmail-sync"},
    {"name":"mavis-goal-loop",          "schedule":"0 */2 * * *",  "fn":"mavis-goal-loop"},
    {"name":"mavis-consolidate",        "schedule":"0 3 * * *",    "fn":"mavis-consolidate"},
    {"name":"mavis-morning-brief",      "schedule":"0 11 * * *",   "fn":"mavis-morning-brief"},
    {"name":"mavis-goal-review",        "schedule":"0 9 * * 1",    "fn":"mavis-goal-review"},
    {"name":"mavis-so-curator",         "schedule":"0 2 * * 0",    "fn":"mavis-so-curator"}
  ]'::jsonb;
  j     JSONB;
  cmd   TEXT;
BEGIN
  FOR j IN SELECT * FROM jsonb_array_elements(jobs) LOOP
    cmd := format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s','apikey','%s'),
        body := '{}'::jsonb
      );$sql$,
      base_url || (j->>'fn'), anon_key, anon_key
    );
    PERFORM public.cron_schedule(j->>'name', j->>'schedule', cmd);
  END LOOP;
END $$;
