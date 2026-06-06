CREATE TABLE IF NOT EXISTS mavis_finetune_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'ollama')),
  job_id TEXT,
  base_model TEXT NOT NULL DEFAULT 'gpt-4o-mini-2024-07-18',
  fine_tuned_model TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  training_file_id TEXT,
  pairs_count INTEGER DEFAULT 0,
  jsonl_path TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mavis_finetune_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_finetune_jobs FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_finetune_jobs_user ON mavis_finetune_jobs(user_id);
CREATE INDEX idx_finetune_jobs_status ON mavis_finetune_jobs(status);
