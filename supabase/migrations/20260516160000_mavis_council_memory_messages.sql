-- MAVIS Council: Per-Agent Memory + Inter-Agent Messaging

-- ── Per-agent memory store ────────────────────────────────────
-- Each council member maintains their own persistent knowledge bank.
-- Members write to it via council_remember action; it's loaded
-- as extra context in every subsequent heartbeat.

CREATE TABLE IF NOT EXISTS mavis_council_memory (
  id                  uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  council_member_id   uuid         NOT NULL REFERENCES councils(id) ON DELETE CASCADE,
  content             text         NOT NULL,
  tags                text[]       DEFAULT '{}',
  embedding           vector(1536),
  created_at          timestamptz  DEFAULT now()
);

ALTER TABLE mavis_council_memory ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own council memory" ON mavis_council_memory FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_council_memory_member
    ON mavis_council_memory (council_member_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Semantic search within a single member's memory bank
CREATE OR REPLACE FUNCTION match_council_memory(
  query_embedding  vector(1536),
  match_member_id  uuid,
  match_threshold  float DEFAULT 0.40,
  match_count      int   DEFAULT 5
) RETURNS TABLE (
  id          uuid,
  content     text,
  tags        text[],
  created_at  timestamptz,
  similarity  float
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.tags,
    m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM mavis_council_memory m
  WHERE m.council_member_id = match_member_id
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ── Async inter-agent messaging ───────────────────────────────
-- Council members send messages to each other via council_message action.
-- Messages sit unread until the recipient's next heartbeat picks them up.

CREATE TABLE IF NOT EXISTS mavis_council_messages (
  id                  uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_member_id      uuid         REFERENCES councils(id) ON DELETE SET NULL,
  from_member_name    text,
  to_member_id        uuid         NOT NULL REFERENCES councils(id) ON DELETE CASCADE,
  to_member_name      text,
  content             text         NOT NULL,
  read                boolean      DEFAULT false,
  created_at          timestamptz  DEFAULT now()
);

ALTER TABLE mavis_council_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own council messages" ON mavis_council_messages FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_council_messages_recipient
    ON mavis_council_messages (to_member_id, read, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
