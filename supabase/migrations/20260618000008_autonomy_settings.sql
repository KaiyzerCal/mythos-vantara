-- Autonomy permission controls: per-category permission levels for MAVIS autonomous actions.
-- permission_level: 'always' | 'ask' | 'never'
-- action_category: 'search' | 'create_task' | 'send_message' | 'log_revenue' |
--                  'advance_plan' | 'modify_calendar' | 'send_email' | 'create_note' | 'execute_code'
CREATE TABLE IF NOT EXISTS mavis_autonomy_settings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_category  text NOT NULL,
  permission_level text NOT NULL DEFAULT 'ask'
    CHECK (permission_level IN ('always', 'ask', 'never')),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (user_id, action_category)
);

ALTER TABLE mavis_autonomy_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "autonomy_settings_user" ON mavis_autonomy_settings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Seed defaults for every new user (permissive defaults — can tighten via UI)
-- These are inserted on first access by the edge function if no row exists.
