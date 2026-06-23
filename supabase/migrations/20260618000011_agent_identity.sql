-- Agent identity: cryptographic signing for MAVIS autonomous actions
CREATE TABLE IF NOT EXISTS mavis_agent_identity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key  text NOT NULL,
  algorithm   text NOT NULL DEFAULT 'ECDSA-P256-SHA256',
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE mavis_agent_identity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_identity_user" ON mavis_agent_identity FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add signature column to agent traces
ALTER TABLE mavis_agent_traces ADD COLUMN IF NOT EXISTS signature text;
