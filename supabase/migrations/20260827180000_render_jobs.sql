-- Persistent job state for the external render service (render-service/).
--
-- Why this exists: the render service used to hold every job in an in-memory
-- Map and serve the finished MP4 from local disk at /file/:token, swept after
-- JOB_TTL_MS (6h default). That file's URL is what mavis-hyperframes stores as
-- hyperframes_renders.render_url, what mavis-video-asset-worker copies into
-- mavis_video_productions.output_url, and what lands permanently in
-- vault_media.file_url — three layers treating a 6-hour-lived local file as
-- the permanent home of a finished video. Every render was on a clock to go
-- dead. Separately, a container restart mid-render lost the job outright:
-- mavis-hyperframes's status poll got a 404 and returned the last known
-- ("rendering") status without updating anything, so the production stayed
-- "rendering" forever with no automatic recovery.
--
-- The fix moves both concerns out of the process. The finished file goes to
-- Supabase Storage (vault-media, same bucket and path convention as beat
-- narration — see beatAudioPath in _shared/videoAssets.ts) and a signed URL
-- is what gets handed back, so the Gallery's existing repairVaultUrls
-- self-heals it exactly like every other vault-media asset already re-signed
-- there. Job status moves into this table, so a restart can mark interrupted
-- jobs as a clean, actionable "error" instead of a silent, permanent hang.
--
-- This table is written only by the render service itself, using the service
-- role key it already needs for storage uploads — no different in kind from
-- hyperframes_renders being owned by an edge function rather than a UI
-- feature. Nothing else in the app queries it.
--
-- NOTE: this backend is Lovable-managed. Committing this file does NOT apply
-- it — see CLAUDE.md. Confirm against the running database before assuming
-- the table exists.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  -- No FK to auth.users — the render service authenticates with the service
  -- role key, not a user JWT, and user_id here is provenance for the storage
  -- path, not an ownership relation Postgres needs to enforce. Per CLAUDE.md's
  -- rule on auth.users: this table has no reason to touch it at all.
  CREATE TABLE IF NOT EXISTS public.render_jobs (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL,

    status         text        NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','rendering','done','error')),

    -- Set once the finished file is uploaded. Both null until then.
    output_path    text,
    output_url     text,

    error_message  text,

    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
  );
END $$;

DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

  -- Deliberately no policies for authenticated/anon. Only the render
  -- service's service-role key ever touches this table — it is not part of
  -- any client-facing surface, the same posture as hyperframes_renders'
  -- provider_job_id column being invisible to the client that reads that row.
  GRANT ALL ON public.render_jobs TO service_role;

  -- The startup recovery sweep's hot path: "which jobs were in flight when
  -- this process last stopped".
  CREATE INDEX IF NOT EXISTS idx_render_jobs_active
    ON public.render_jobs (status)
    WHERE status IN ('queued','rendering');

  CREATE INDEX IF NOT EXISTS idx_render_jobs_user
    ON public.render_jobs (user_id, created_at DESC);

  BEGIN
    CREATE TRIGGER render_jobs_updated_at
    BEFORE UPDATE ON public.render_jobs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
