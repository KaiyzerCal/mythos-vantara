-- Activate council_sessions (existed but was never used) and add group message history

ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS active       boolean   DEFAULT false;
ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS topic        text;
ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS voice_mode   boolean   DEFAULT false;
ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS turn_count   integer   DEFAULT 0;
ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS started_at   timestamptz;
ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS ended_at     timestamptz;

DO $$ BEGIN
  CREATE INDEX idx_council_sessions_user_active ON council_sessions(user_id, active) WHERE active = true;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-turn message log for group sessions (text and voice)
CREATE TABLE IF NOT EXISTS council_group_messages (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users NOT NULL,
  session_id   uuid REFERENCES council_sessions NOT NULL,
  speaker_type text NOT NULL,   -- 'user' | 'council' | 'mavis'
  speaker_id   uuid,            -- council member ID (null for user/mavis)
  speaker_name text NOT NULL,
  speaker_role text,
  content      text NOT NULL,
  turn_number  integer DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE council_group_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own group messages" ON council_group_messages
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_council_group_msgs_session ON council_group_messages(session_id, turn_number, created_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
