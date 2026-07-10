-- Fix: mavis_persona_memory was created with a UNIQUE INDEX on (user_id, key)
-- but PostgREST upsert requires a named UNIQUE CONSTRAINT (not just an index)
-- for onConflict resolution to work. This caused the "memory tool's conflict
-- specification" error in mavis-agent's save_memory tool.

ALTER TABLE public.mavis_persona_memory
  DROP CONSTRAINT IF EXISTS mavis_persona_memory_user_key_unique;

ALTER TABLE public.mavis_persona_memory
  ADD CONSTRAINT mavis_persona_memory_user_key_unique UNIQUE (user_id, key);
