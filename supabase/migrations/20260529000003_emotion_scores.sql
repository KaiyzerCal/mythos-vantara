-- Add structured emotion scores to journal entries
-- Uses Hume AI Expression Measurement API results (48-dim emotion vector stored as jsonb)

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS emotion_scores  jsonb,
  ADD COLUMN IF NOT EXISTS emotion_tagged  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dominant_emotion text;

-- Index for emotion-based queries (e.g., "show me all anxious entries")
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS journal_emotion_idx
    ON journal_entries USING gin(emotion_scores);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Index for dominant emotion filtering
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS journal_dominant_emotion_idx
    ON journal_entries (user_id, dominant_emotion)
    WHERE dominant_emotion IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Emotion trend view: aggregated weekly emotion averages per user
CREATE OR REPLACE VIEW emotion_weekly_trends AS
  SELECT
    user_id,
    date_trunc('week', created_at) AS week,
    dominant_emotion,
    count(*) AS entry_count,
    avg((emotion_scores->>'determination')::float) AS avg_determination,
    avg((emotion_scores->>'anxiety')::float)       AS avg_anxiety,
    avg((emotion_scores->>'joy')::float)            AS avg_joy,
    avg((emotion_scores->>'sadness')::float)        AS avg_sadness,
    avg((emotion_scores->>'excitement')::float)     AS avg_excitement,
    avg((emotion_scores->>'tiredness')::float)      AS avg_tiredness,
    avg((emotion_scores->>'focus')::float)          AS avg_focus,
    avg((emotion_scores->>'pride')::float)          AS avg_pride,
    avg((emotion_scores->>'frustration')::float)    AS avg_frustration,
    avg((emotion_scores->>'gratitude')::float)      AS avg_gratitude
  FROM journal_entries
  WHERE emotion_scores IS NOT NULL
  GROUP BY user_id, week, dominant_emotion;
