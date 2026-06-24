-- Multi-step campaigns + human-in-the-loop action queue + approval-learning.
-- Adds: mavis_action_queue, mavis_campaigns, pg trigger for autonomy learning,
-- cron for campaign runner.

-- ── mavis_action_queue ────────────────────────────────────────────────────────
-- Holds every autonomous action MAVIS wants to take, awaiting operator review
-- (or executing automatically for auto-tier actions).

CREATE TABLE IF NOT EXISTS public.mavis_action_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type     text        NOT NULL,
  action_payload  jsonb       NOT NULL DEFAULT '{}',
  autonomy_tier   text        NOT NULL DEFAULT 'approve', -- auto | queue | approve
  status          text        NOT NULL DEFAULT 'pending', -- pending | approved | rejected | executing | executed | failed
  priority        integer     NOT NULL DEFAULT 5,
  source_system   text,
  source_context  text,
  summary         text,
  approved_at     timestamptz,
  executed_at     timestamptz,
  result_data     jsonb,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_queue_user_status
  ON public.mavis_action_queue(user_id, status);

CREATE INDEX IF NOT EXISTS idx_action_queue_user_type
  ON public.mavis_action_queue(user_id, action_type);

ALTER TABLE public.mavis_action_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_action_queue' AND policyname = 'Users manage own action queue'
  ) THEN
    CREATE POLICY "Users manage own action queue"
      ON public.mavis_action_queue FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_action_queue' AND policyname = 'Service role full access action queue'
  ) THEN
    CREATE POLICY "Service role full access action queue"
      ON public.mavis_action_queue FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── mavis_campaigns ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mavis_campaigns (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  description  text,
  status       text        NOT NULL DEFAULT 'active',  -- active | paused | completed | cancelled
  steps        jsonb       NOT NULL DEFAULT '[]',
  current_step integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_status
  ON public.mavis_campaigns(user_id, status);

ALTER TABLE public.mavis_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_campaigns' AND policyname = 'Users manage own campaigns'
  ) THEN
    CREATE POLICY "Users manage own campaigns"
      ON public.mavis_campaigns FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_campaigns' AND policyname = 'Service role full access campaigns'
  ) THEN
    CREATE POLICY "Service role full access campaigns"
      ON public.mavis_campaigns FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Ensure mavis_autonomy_config has updated_at + unique constraint ───────────

ALTER TABLE public.mavis_autonomy_config
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mavis_autonomy_config_user_id_action_type_key'
  ) THEN
    ALTER TABLE public.mavis_autonomy_config
      ADD CONSTRAINT mavis_autonomy_config_user_id_action_type_key
      UNIQUE (user_id, action_type);
  END IF;
END $$;

-- ── Approval learning trigger ─────────────────────────────────────────────────
-- When operator approves/rejects an action, recalculate 30-day approval rate
-- and auto-adjust autonomy tier for that action_type.
-- >= 90% approval + >= 5 samples  -> upgrade "approve" -> "queue"
-- >= 70% rejection + >= 5 samples -> downgrade "queue"/"auto" -> "approve"

CREATE OR REPLACE FUNCTION public.mavis_learn_from_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_approved      integer;
  v_rejected      integer;
  v_total         integer;
  v_approval_rate numeric;
  v_current_tier  text;
  v_new_tier      text;
BEGIN
  IF NEW.status NOT IN ('approved', 'rejected')             THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('pending', 'executing', 'approved') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status                                THEN RETURN NEW; END IF;
  IF NEW.action_type IS NULL                                THEN RETURN NEW; END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*) FILTER (WHERE status = 'rejected'),
    COUNT(*)
  INTO v_approved, v_rejected, v_total
  FROM public.mavis_action_queue
  WHERE user_id     = NEW.user_id
    AND action_type = NEW.action_type
    AND status      IN ('approved', 'rejected')
    AND created_at  > NOW() - INTERVAL '30 days';

  IF v_total < 5 THEN RETURN NEW; END IF;

  v_approval_rate := v_approved::numeric / GREATEST(v_total, 1);

  SELECT tier INTO v_current_tier
  FROM public.mavis_autonomy_config
  WHERE user_id = NEW.user_id AND action_type = NEW.action_type;

  v_current_tier := COALESCE(v_current_tier, 'approve');

  IF v_approval_rate >= 0.90 AND v_current_tier = 'approve' THEN
    v_new_tier := 'queue';
  ELSIF (1.0 - v_approval_rate) >= 0.70 AND v_current_tier IN ('queue', 'auto') THEN
    v_new_tier := 'approve';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.mavis_autonomy_config(user_id, action_type, tier, updated_at)
  VALUES (NEW.user_id, NEW.action_type, v_new_tier, NOW())
  ON CONFLICT (user_id, action_type)
  DO UPDATE SET tier = v_new_tier, updated_at = NOW();

  INSERT INTO public.mavis_persona_memory(user_id, key, value, category, importance, source, role)
  VALUES (
    NEW.user_id,
    'autonomy_tier_change:' || NEW.action_type,
    'Auto-adjusted ' || NEW.action_type || ' tier: ' || v_current_tier || ' -> ' || v_new_tier ||
    ' (' || v_total || ' samples, ' || ROUND(v_approval_rate * 100) || '% approval rate over 30 days)',
    'system',
    6,
    'mavis-learning',
    'system'
  )
  ON CONFLICT (user_id, key)
  DO UPDATE SET value = EXCLUDED.value, created_at = NOW();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS mavis_approval_learning_trigger ON public.mavis_action_queue;
CREATE TRIGGER mavis_approval_learning_trigger
  AFTER UPDATE ON public.mavis_action_queue
  FOR EACH ROW EXECUTE FUNCTION public.mavis_learn_from_approval();

-- ── pg_cron: campaign runner every 4 hours (offset 30 min from goal-agent) ───

DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL'              LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM cron.schedule(
      'mavis-campaign-runner-4h',
      '30 */4 * * *',
      format(
        $cron$
        SELECT net.http_post(
          url     := %L || '/functions/v1/mavis-campaign-runner',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
          body    := '{"action":"run"}'::jsonb
        );
        $cron$,
        v_url, v_key
      )
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
