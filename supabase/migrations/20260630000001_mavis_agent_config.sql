-- mavis_agent_config
-- Per-user MAVIS "living constitution" — identity, voice, memory rules, operator context.
-- Rows are injected into the MAVIS system prompt at the start of every session so Calvin
-- can evolve MAVIS's behaviour without touching edge function code.
-- Edit via System Settings > MAVIS Config, or directly in the DB.

CREATE TABLE IF NOT EXISTS mavis_agent_config (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users NOT NULL,
  section     text        NOT NULL,
  content     text        NOT NULL,
  enabled     boolean     DEFAULT true,
  sort_order  integer     DEFAULT 0,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, section)
);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_mavis_agent_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER mavis_agent_config_updated_at
  BEFORE UPDATE ON mavis_agent_config
  FOR EACH ROW EXECUTE FUNCTION update_mavis_agent_config_updated_at();

-- RLS: users manage their own config rows only
ALTER TABLE mavis_agent_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own mavis_agent_config"
  ON mavis_agent_config
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
