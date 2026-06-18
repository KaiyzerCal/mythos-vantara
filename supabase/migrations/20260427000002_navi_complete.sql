-- ── NAVI Complete System: Memory Consolidation, Heartbeat, Milestones, Platform Foundation ──

-- Track which episodic memories have been consolidated into semantic summaries
ALTER TABLE persona_memories ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ;

-- ── Heartbeat Notifications ──────────────────────────────────────────────────
-- NAVIs reach out proactively when the user has been absent. Messages are stored
-- here and delivered via realtime subscription on the frontend.
CREATE TABLE IF NOT EXISTS navi_notifications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id        UUID        NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message           TEXT        NOT NULL,
  notification_type TEXT        NOT NULL DEFAULT 'heartbeat',
  is_read           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE navi_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their notifications" ON navi_notifications
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_navi_notifications_user
  ON navi_notifications(user_id, is_read, created_at DESC);

-- Enable realtime so the frontend gets instant notification delivery
ALTER TABLE navi_notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE navi_notifications;

-- ── Platform Foundation: Organizations + API Keys ────────────────────────────
-- Multi-tenant platform scaffold. Existing personal-use data (user_id-scoped)
-- continues to work unchanged. org_id columns will be added in Phase 1.

CREATE TABLE IF NOT EXISTS organizations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  slug              TEXT        UNIQUE,
  owner_user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan              TEXT        NOT NULL DEFAULT 'free',
  monthly_call_limit INT        NOT NULL DEFAULT 500,
  calls_this_month  INT         NOT NULL DEFAULT 0,
  reset_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their org" ON organizations
  FOR ALL USING (owner_user_id = auth.uid());

-- API keys: key_hash stores SHA-256 of the raw key; key_prefix for display
CREATE TABLE IF NOT EXISTS org_api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_hash     TEXT        NOT NULL UNIQUE,
  key_prefix   TEXT        NOT NULL,   -- e.g. "navi_abc1" — first 10 chars, safe to show
  name         TEXT        NOT NULL DEFAULT 'Default',
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE org_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org owners manage api keys" ON org_api_keys
  FOR ALL USING (
    org_id IN (SELECT id FROM organizations WHERE owner_user_id = auth.uid())
  );

-- Per-key usage log for billing and rate-limiting
CREATE TABLE IF NOT EXISTS api_usage (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  api_key_id   UUID        REFERENCES org_api_keys(id) ON DELETE SET NULL,
  user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  endpoint     TEXT        NOT NULL,
  tokens_in    INT         NOT NULL DEFAULT 0,
  tokens_out   INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_org_day
  ON api_usage(org_id, created_at DESC);
