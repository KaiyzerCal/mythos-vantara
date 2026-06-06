CREATE TABLE IF NOT EXISTS receptionist_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES receptionist_businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_id UUID REFERENCES receptionist_calls(id),
  caller_number TEXT,
  caller_name TEXT DEFAULT '',
  message TEXT NOT NULL,
  urgency TEXT DEFAULT 'normal' CHECK (urgency IN ('low','normal','high','urgent')),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE receptionist_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON receptionist_messages FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_receptionist_messages_business ON receptionist_messages(business_id);
CREATE INDEX idx_receptionist_messages_unread ON receptionist_messages(user_id, is_read);
