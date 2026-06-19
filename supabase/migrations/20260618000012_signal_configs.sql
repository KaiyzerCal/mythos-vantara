-- Signal configurations for proactive MAVIS session initiation
CREATE TABLE IF NOT EXISTS mavis_signal_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type     text NOT NULL CHECK (signal_type IN ('rss', 'keyword_email', 'keyword_telegram', 'market_move', 'calendar_change', 'custom_webhook')),
  name            text NOT NULL,
  source          text NOT NULL,  -- URL for RSS, ticker for market, keyword list as JSON array string for keyword signals
  threshold       jsonb,          -- e.g. {"price_change_pct": 5} or {"keywords": ["urgent","deadline"]} or {"min_relevance": 7}
  is_active       boolean NOT NULL DEFAULT true,
  cooldown_hours  int NOT NULL DEFAULT 4,  -- minimum hours between triggers for same signal
  last_triggered_at timestamptz,
  last_checked_at   timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE mavis_signal_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signal_configs_user" ON mavis_signal_configs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Runs every 15 minutes
SELECT cron.schedule('mavis-signal-watcher', '*/15 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-signal-watcher',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := jsonb_build_object('action', 'watch_signals')
  ) AS request_id$$
);
