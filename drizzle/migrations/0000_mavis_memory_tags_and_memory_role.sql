SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- mavis-memory-agent saves/recalls with a tags array and role 'memory';
-- the table had neither, so every save and recall errored.
ALTER TABLE public.mavis_memory ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.mavis_memory DROP CONSTRAINT IF EXISTS mavis_memory_role_check;
ALTER TABLE public.mavis_memory ADD CONSTRAINT mavis_memory_role_check CHECK (role IN ('user', 'assistant', 'system', 'memory'));