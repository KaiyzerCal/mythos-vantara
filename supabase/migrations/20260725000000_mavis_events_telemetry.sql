-- ─────────────────────────────────────────────────────────────────────────────
-- mavis_events — baseline product telemetry (Stabilization Brief Phase 1.4)
--
-- No analytics existed anywhere in the client — no way to answer "what does
-- the operator actually use daily" vs. "what was integrated once and never
-- fired." This is the minimal event log the Phase 3 usage audit depends on.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mavis_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name  text        NOT NULL,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  metadata    jsonb        NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mavis_events_name_created
  ON public.mavis_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mavis_events_user_created
  ON public.mavis_events (user_id, created_at DESC);

ALTER TABLE public.mavis_events ENABLE ROW LEVEL SECURITY;

-- Operators can write their own events (client-side logEvent()) and read them
-- back (for the Phase 3 usage audit). Edge functions use the service role,
-- which bypasses RLS.
DO $$ BEGIN
  CREATE POLICY "insert own events" ON public.mavis_events
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "read own events" ON public.mavis_events
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
