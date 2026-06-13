CREATE TABLE IF NOT EXISTS receptionist_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES receptionist_businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vapi_call_id TEXT UNIQUE,
  caller_number TEXT,
  duration_seconds INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed' CHECK (status IN ('in_progress','completed','failed','transferred','voicemail')),
  outcome TEXT DEFAULT '',
  transcript TEXT DEFAULT '',
  recording_url TEXT,
  follow_up_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE receptionist_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON receptionist_calls FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_receptionist_calls_business ON receptionist_calls(business_id);
CREATE INDEX idx_receptionist_calls_user ON receptionist_calls(user_id);
CREATE INDEX idx_receptionist_calls_created ON receptionist_calls(created_at DESC);
