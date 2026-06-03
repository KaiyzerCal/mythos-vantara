CREATE TABLE IF NOT EXISTS receptionist_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES receptionist_businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  vapi_phone_number_id TEXT NOT NULL UNIQUE,
  vapi_assistant_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE receptionist_phone_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON receptionist_phone_numbers FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_receptionist_phone_user ON receptionist_phone_numbers(user_id);
CREATE INDEX idx_receptionist_phone_vapi ON receptionist_phone_numbers(vapi_phone_number_id);
