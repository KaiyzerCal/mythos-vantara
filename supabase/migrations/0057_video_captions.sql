-- Add caption_words column to video_clips
ALTER TABLE video_clips ADD COLUMN IF NOT EXISTS caption_words JSONB DEFAULT '[]'::jsonb;

-- Add source_url column to video_clips (for URL-imported videos)
ALTER TABLE video_clips ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Create video render jobs table for async compilation tracking
CREATE TABLE IF NOT EXISTS video_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES video_projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','complete','failed')),
  progress INTEGER DEFAULT 0,
  output_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- If the table already existed from a prior migration (video_editor.sql) it will have
-- clip_id NOT NULL, input_url NOT NULL, and lack project_id/progress/error_message/updated_at.
-- Patch it to support the server-side compile workflow.
ALTER TABLE video_render_jobs ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES video_projects(id) ON DELETE CASCADE;
ALTER TABLE video_render_jobs ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
ALTER TABLE video_render_jobs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE video_render_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
-- Make clip_id and input_url nullable so compile jobs can be inserted without them
DO $$ BEGIN
  ALTER TABLE video_render_jobs ALTER COLUMN clip_id DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE video_render_jobs ALTER COLUMN input_url DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_video_render_jobs_project ON video_render_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_video_render_jobs_user ON video_render_jobs(user_id);
