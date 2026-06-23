-- MAVIS Trigger Engine: autonomy config, trigger subscriptions, trigger log
-- Enables fully autonomous action execution and event-driven agent wakeup.

-- ── 1. mavis_autonomy_config — per-user per-action-type tier setting ──────────

CREATE TABLE IF NOT EXISTS public.mavis_autonomy_config (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text         NOT NULL,
  tier        text         NOT NULL DEFAULT 'approve', -- auto | queue | approve
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, action_type)
);

ALTER TABLE public.mavis_autonomy_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own autonomy config" ON public.mavis_autonomy_config
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service role autonomy" ON public.mavis_autonomy_config
    AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. mavis_trigger_subscriptions — which triggers each user has enabled ─────

CREATE TABLE IF NOT EXISTS public.mavis_trigger_subscriptions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_type    text         NOT NULL, -- new_email | calendar_reminder | overdue_task | goal_check
  enabled         boolean      NOT NULL DEFAULT true,
  config          jsonb        NOT NULL DEFAULT '{}',
  last_checked_at timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, trigger_type)
);

ALTER TABLE public.mavis_trigger_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own trigger subs" ON public.mavis_trigger_subscriptions
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service role trigger subs" ON public.mavis_trigger_subscriptions
    AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. mavis_trigger_log — what the engine found and did ─────────────────────

CREATE TABLE IF NOT EXISTS public.mavis_trigger_log (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_types   text[]       NOT NULL DEFAULT '{}',
  context_summary text,
  agent_response  text,
  actions_auto    integer      NOT NULL DEFAULT 0,
  actions_queued  integer      NOT NULL DEFAULT 0,
  ran_at          timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_trigger_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own trigger log" ON public.mavis_trigger_log
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service role trigger log" ON public.mavis_trigger_log
    AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_trigger_log_user_ran
  ON public.mavis_trigger_log(user_id, ran_at DESC);

-- ── 4. Cron: trigger engine every 10 minutes ──────────────────────────────────

DO $$
DECLARE
  v_url   text;
  v_key   text;
BEGIN
  SELECT decrypted_secret INTO v_url  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL'          LIMIT 1;
  SELECT decrypted_secret INTO v_key  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM cron.schedule(
      'mavis-trigger-engine-10m',
      '*/10 * * * *',
      format(
        $cron$
        SELECT net.http_post(
          url     := %L || '/functions/v1/mavis-trigger-engine',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
          body    := '{"action":"run"}'::jsonb
        );
        $cron$,
        v_url, v_key
      )
    );
  END IF;
EXCEPTION WHEN others THEN
  NULL; -- cron extension may not be enabled; safe to skip
END $$;
