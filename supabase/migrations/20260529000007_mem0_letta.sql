-- Mem0 sync log: tracks which conversations have been synced to Mem0
CREATE TABLE IF NOT EXISTS mavis_mem0_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  conversation_id text,
  synced_at timestamptz DEFAULT now(),
  memory_count int DEFAULT 0,
  UNIQUE(user_id, conversation_id)
);
ALTER TABLE mavis_mem0_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own mem0 log" ON mavis_mem0_sync_log FOR ALL USING (auth.uid() = user_id);

-- Letta agent registry: one Letta agent per MAVIS mode/persona
CREATE TABLE IF NOT EXISTS mavis_letta_agents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  letta_agent_id text NOT NULL,
  persona_name text NOT NULL DEFAULT 'MAVIS',
  created_at timestamptz DEFAULT now(),
  last_messaged_at timestamptz,
  UNIQUE(user_id, persona_name)
);
ALTER TABLE mavis_letta_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own letta agents" ON mavis_letta_agents FOR ALL USING (auth.uid() = user_id);
