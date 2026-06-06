-- ============================================================
-- VANTARA.EXE — Full Ecosystem Integration Pack
-- Skill Catalog (agentskills.io/Hermes), OpenHuman Heartbeat,
-- Run Doctor health checks, Device Pairing approval
-- ============================================================

-- 1. mavis_user_skills — tracks installed catalog skills per user
CREATE TABLE IF NOT EXISTS public.mavis_user_skills (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_slug     TEXT NOT NULL,
  custom_skill_id UUID REFERENCES public.mavis_custom_skills(id) ON DELETE SET NULL,
  installed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skill_slug)
);
ALTER TABLE public.mavis_user_skills ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own installed skills" ON public.mavis_user_skills
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. mavis_sync_log — OpenHuman Heartbeat sync history
CREATE TABLE IF NOT EXISTS public.mavis_sync_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sync_type      TEXT NOT NULL,
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','success','skipped','error')),
  records_synced INT DEFAULT 0,
  error_message  TEXT,
  duration_ms    INT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.mavis_sync_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own sync logs" ON public.mavis_sync_log
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_sync_log_user_created ON public.mavis_sync_log(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- 3. mavis_device_sessions — OpenClaw device pairing approval
CREATE TABLE IF NOT EXISTS public.mavis_device_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name         TEXT NOT NULL,
  device_fingerprint  TEXT NOT NULL,
  platform            TEXT DEFAULT 'web',
  user_agent          TEXT,
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','revoked')),
  last_seen_at        TIMESTAMPTZ DEFAULT NOW(),
  approved_at         TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_fingerprint)
);
ALTER TABLE public.mavis_device_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own devices" ON public.mavis_device_sessions
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. mavis_health_checks — Run Doctor results cache
CREATE TABLE IF NOT EXISTS public.mavis_health_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_name TEXT NOT NULL,
  status           TEXT DEFAULT 'unknown' CHECK (status IN ('healthy','degraded','error','unconfigured','unknown')),
  response_ms      INT,
  message          TEXT,
  checked_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, integration_name)
);
ALTER TABLE public.mavis_health_checks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own health checks" ON public.mavis_health_checks
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Register heartbeat cron (every 20 minutes)
INSERT INTO mavis_cron_config (job_name, edge_function, schedule, payload)
VALUES ('mavis-heartbeat', 'mavis-heartbeat', '*/20 * * * *', '{"scheduled":true}')
ON CONFLICT (job_name) DO NOTHING;

-- 6. Register obsidian export + run doctor (on-demand only, no cron)
-- These are called directly from the frontend, no cron needed.
