-- Track the latest fine-tuned Ollama model name from the self-improve pipeline
ALTER TABLE mavis_improvement_log
  ADD COLUMN IF NOT EXISTS trained_model_name text;

CREATE INDEX IF NOT EXISTS idx_improvement_log_model
  ON mavis_improvement_log (user_id, trained_model_name, created_at DESC)
  WHERE trained_model_name IS NOT NULL;
