-- MAVIS Phone Calls — VAPI outbound/inbound AI call log
CREATE TABLE IF NOT EXISTS mavis_calls (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  vapi_call_id text,
  direction text NOT NULL DEFAULT 'outbound',        -- outbound | inbound
  to_number text,
  from_number text,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'initiated',          -- initiated | ringing | in-progress | ended | failed
  transcript jsonb DEFAULT '[]',                     -- [{role, text, timestamp}]
  summary text,
  outcome text,                                      -- e.g. "table reserved for 7pm"
  duration_seconds integer,
  cost_cents integer,
  recording_url text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  ended_at timestamptz
);

ALTER TABLE mavis_calls ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own calls" ON mavis_calls FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_calls_user ON mavis_calls(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_calls_vapi ON mavis_calls(vapi_call_id) WHERE vapi_call_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL; END $$;
