-- Achievements / badge system
CREATE TABLE IF NOT EXISTS achievements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  icon         TEXT DEFAULT '🏆',
  category     TEXT NOT NULL DEFAULT 'general'
                 CHECK (category IN ('quests','habits','finance','social','knowledge','bond','special')),
  unlocked_at  TIMESTAMPTZ DEFAULT now(),
  data         JSONB DEFAULT '{}'::jsonb,
  UNIQUE(user_id, achievement_key)
);
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own achievements" ON achievements FOR ALL USING (auth.uid() = user_id);

-- CRM follow-up config columns on contacts (add if missing)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='follow_up_days') THEN
    ALTER TABLE contacts ADD COLUMN follow_up_days INT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='birthday') THEN
    ALTER TABLE contacts ADD COLUMN birthday DATE;
  END IF;
END $$;

-- Slack config
CREATE TABLE IF NOT EXISTS mavis_slack_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  workspace_name  TEXT,
  bot_user_id     TEXT,
  default_channel TEXT,
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE mavis_slack_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own slack config" ON mavis_slack_config FOR ALL USING (auth.uid() = user_id);

-- Cron: auto-journal at 21:00 UTC daily
SELECT cron.schedule('mavis-auto-journal', '0 21 * * *', $$
  SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-auto-journal',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb);
$$);

-- Cron: CRM nudge at 09:00 UTC daily
SELECT cron.schedule('mavis-crm-nudge', '0 9 * * *', $$
  SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-crm-nudge',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb);
$$);

-- Cron: sleep coaching at 07:00 UTC daily (after morning brief)
SELECT cron.schedule('mavis-sleep-coach', '0 7 * * *', $$
  SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-sleep-coach',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb);
$$);
