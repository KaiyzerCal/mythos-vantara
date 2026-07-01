-- mavis_worldmonitor_cache: shared cache for globe events and AI intelligence briefs
-- No user_id — data is global, written only by service-role edge functions
CREATE TABLE IF NOT EXISTS mavis_worldmonitor_cache (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key   text        NOT NULL UNIQUE,
  data        jsonb       NOT NULL DEFAULT '{}',
  fetched_at  timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS mavis_worldmonitor_cache_key_idx     ON mavis_worldmonitor_cache (cache_key);
CREATE INDEX IF NOT EXISTS mavis_worldmonitor_cache_expires_idx ON mavis_worldmonitor_cache (expires_at);

-- Only service role can write; no RLS (global shared cache, no user-specific data)
