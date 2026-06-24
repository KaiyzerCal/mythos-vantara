-- MAVIS Social Queue
-- Replaces Google Sheets as the content pipeline queue.
-- Each row = one article URL → multi-platform content campaign.

create table if not exists mavis_social_queue (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade not null,

  -- Source
  source_url          text,
  scheduled_date      date,

  -- Extracted content (article extractor writes here)
  article_title       text,
  article_text        text,

  -- Path A — Long-form: Facebook, LinkedIn, Instagram (+ generated image)
  facebook_content    text,
  linkedin_content    text,
  instagram_content   text,
  generated_image_url text,

  -- Path B — Short-form: Twitter/X + Threads (text only)
  twitter_content     text,
  threads_content     text,

  -- Path C — Video: TikTok / Reels (HeyGen avatar + caption)
  video_script        text,
  video_caption       text,
  tiktok_content      text,
  video_url           text,
  heygen_video_id     text,

  -- Per-step status
  extraction_status   text not null default 'pending'
    check (extraction_status  in ('pending','done','failed')),
  image_status        text not null default 'pending'
    check (image_status       in ('pending','done','failed','skipped')),
  video_status        text not null default 'pending'
    check (video_status       in ('pending','processing','done','failed','skipped')),

  -- Overall pipeline status
  status              text not null default 'pending'
    check (status in ('pending','extracting','generating','ready','publishing','published','failed')),

  -- Results
  published_at        timestamptz,
  publish_results     jsonb default '{}',
  error_message       text,
  notes               text,

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists idx_msq_user_status
  on mavis_social_queue(user_id, status, scheduled_date);

alter table mavis_social_queue enable row level security;

do $$ begin
  create policy "users own social queue"
    on mavis_social_queue for all using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Auto-update updated_at
create or replace function mavis_social_queue_set_updated()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_msq_updated on mavis_social_queue;
create trigger trg_msq_updated
  before update on mavis_social_queue
  for each row execute function mavis_social_queue_set_updated();
