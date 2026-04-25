-- Migration 1: personas table
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  archetype TEXT NOT NULL,
  personality JSONB NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL,
  avatar_key TEXT,
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  embodiment_endpoint TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their personas" ON personas
  FOR ALL USING (auth.uid() = user_id);
