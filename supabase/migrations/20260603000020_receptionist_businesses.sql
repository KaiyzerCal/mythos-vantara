CREATE TABLE IF NOT EXISTS receptionist_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry TEXT DEFAULT 'general',
  description TEXT DEFAULT '',
  greeting TEXT DEFAULT 'Thank you for calling. How can I help you today?',
  hours JSONB DEFAULT '{"mon":{"open":"09:00","close":"17:00"},"tue":{"open":"09:00","close":"17:00"},"wed":{"open":"09:00","close":"17:00"},"thu":{"open":"09:00","close":"17:00"},"fri":{"open":"09:00","close":"17:00"},"sat":null,"sun":null}'::jsonb,
  timezone TEXT DEFAULT 'America/New_York',
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter','pro','enterprise')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE receptionist_businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON receptionist_businesses FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_receptionist_businesses_user ON receptionist_businesses(user_id);
