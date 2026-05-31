-- Migration 4: persona_conversations table
CREATE TABLE persona_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  emotion_detected TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE persona_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their persona conversations" ON persona_conversations
  FOR ALL USING (auth.uid() = user_id);
