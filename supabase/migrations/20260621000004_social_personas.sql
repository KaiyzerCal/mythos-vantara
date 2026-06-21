-- Multi-persona social media system
-- Persona config lives in DB; credentials stay in Supabase env secrets.
-- Credential lookup pattern: each platform entry has a cred_prefix,
--   e.g. "TWITTER_NORA" → env vars TWITTER_NORA_API_KEY, _API_SECRET,
--   _ACCESS_TOKEN, _ACCESS_SECRET. Add a new persona by adding a row
--   and setting the right env vars.

CREATE TABLE IF NOT EXISTS mavis_social_personas (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users NOT NULL,
  persona_name  text NOT NULL,            -- machine key: 'nora_vale', 'bioneerx'
  display_name  text NOT NULL,            -- shown name: 'Nora Vale', 'BioneerX'
  bio           text,                     -- 1-2 sentence identity blurb
  voice         text NOT NULL,            -- writing style description fed to Claude
  topics        text[]  DEFAULT '{}',     -- subject areas (used for content prompts)
  tone          text    DEFAULT 'professional',
  platforms     jsonb   DEFAULT '{}',
  -- platforms shape:
  -- {
  --   "twitter":   { "cred_prefix": "TWITTER_NORA",    "enabled": true, "style": "..." },
  --   "linkedin":  { "cred_prefix": "LINKEDIN_NORA",   "enabled": true, "style": "..." },
  --   "instagram": { "cred_prefix": "INSTAGRAM_NORA",  "enabled": false },
  --   "tiktok":    { "cred_prefix": "TIKTOK_NORA",     "enabled": false }
  -- }
  post_formats  jsonb   DEFAULT '{}',
  -- post_formats: per-platform length/hashtag/emoji preferences
  -- { "twitter": { "max_chars": 280, "hashtags": 2, "use_emoji": true } }
  active        boolean DEFAULT true,
  metadata      jsonb   DEFAULT '{}',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(user_id, persona_name)
);

ALTER TABLE mavis_social_personas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own personas" ON mavis_social_personas
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_social_personas_user ON mavis_social_personas(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Post history — tracks every generated, scheduled, and posted piece of content
CREATE TABLE IF NOT EXISTS mavis_social_posts (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users NOT NULL,
  persona_id    uuid REFERENCES mavis_social_personas NOT NULL,
  platform      text NOT NULL,            -- 'twitter'|'linkedin'|'instagram'|'tiktok'|'discord'
  content       text NOT NULL,
  media_urls    text[]  DEFAULT '{}',
  status        text    DEFAULT 'draft',  -- draft|scheduled|posted|failed
  scheduled_at  timestamptz,
  posted_at     timestamptz,
  external_id   text,                     -- tweet_id, linkedin URN, etc.
  error         text,
  metadata      jsonb   DEFAULT '{}',
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE mavis_social_posts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own social posts" ON mavis_social_posts
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_social_posts_persona ON mavis_social_posts(persona_id, status, scheduled_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_social_posts_user_status ON mavis_social_posts(user_id, status) WHERE status IN ('scheduled','draft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
