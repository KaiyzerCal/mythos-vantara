-- Video projects (one per uploaded/linked video)
CREATE TABLE IF NOT EXISTS video_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL,
  source_url text,                    -- original video URL (storage or external)
  source_type text DEFAULT 'upload',  -- upload|youtube|loom|url
  duration_seconds int,
  status text DEFAULT 'pending',      -- pending|analyzing|ready|error
  transcript text,                    -- full transcript text
  transcript_chunks jsonb,            -- array of {start, end, text} word-level chunks
  gemini_analysis jsonb,              -- raw Gemini analysis output
  summary text,
  language text DEFAULT 'en',
  storage_path text,                  -- path in Supabase Storage
  thumbnail_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Scored segments (10-second windows scored across 6 dimensions)
CREATE TABLE IF NOT EXISTS video_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES video_projects ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  start_seconds numeric NOT NULL,
  end_seconds numeric NOT NULL,
  transcript_text text,
  score_energy numeric DEFAULT 0,       -- 0-10: voice amplitude, pace, exclamations
  score_insight numeric DEFAULT 0,      -- 0-10: semantic density, novel info, data
  score_emotion numeric DEFAULT 0,      -- 0-10: emotional language, sentiment peaks
  score_hook numeric DEFAULT 0,         -- 0-10: opens with question/surprise/claim
  score_quotability numeric DEFAULT 0,  -- 0-10: complete standalone thought
  score_visual numeric DEFAULT 0,       -- 0-10: visual energy, scene interest
  viral_score numeric DEFAULT 0,        -- 0-10: weighted composite
  segment_order int NOT NULL
);

-- Generated clips (recommended cuts for specific output formats)
CREATE TABLE IF NOT EXISTS video_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES video_projects ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL,
  start_seconds numeric NOT NULL,
  end_seconds numeric NOT NULL,
  duration_seconds numeric,
  format text NOT NULL,               -- shorts|reels|highlight|long_form|custom
  aspect_ratio text DEFAULT '9:16',   -- 9:16|16:9|1:1
  viral_score numeric DEFAULT 0,
  why_viral text,
  suggested_caption text,
  suggested_hashtags text[],
  transcript_excerpt text,
  render_status text DEFAULT 'pending', -- pending|rendering|ready|error
  render_url text,                    -- URL of rendered clip
  thumbnail_url text,
  render_job_id text,                 -- fal.ai or render provider job ID
  nora_queued boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Render jobs (async rendering queue)
CREATE TABLE IF NOT EXISTS video_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid REFERENCES video_clips ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  provider text DEFAULT 'fal',
  provider_job_id text,
  status text DEFAULT 'pending',      -- pending|processing|complete|failed
  input_url text NOT NULL,
  output_url text,
  ffmpeg_cmd text,                    -- the FFmpeg command used (for transparency)
  error_message text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- RLS
ALTER TABLE video_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own video_projects" ON video_projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own video_segments" ON video_segments FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own video_clips" ON video_clips FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own video_render_jobs" ON video_render_jobs FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_video_projects_user ON video_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_video_segments_project ON video_segments(project_id);
CREATE INDEX IF NOT EXISTS idx_video_clips_project ON video_clips(project_id);
CREATE INDEX IF NOT EXISTS idx_video_clips_format ON video_clips(project_id, format);

-- Storage bucket note
-- Run: supabase storage buckets create video-projects --public
-- Or create via dashboard: Storage → New bucket → "video-projects" → Public
