-- Fix: mavis_persona_memory was created with a UNIQUE INDEX on (user_id, key)
-- but PostgREST upsert requires a named UNIQUE CONSTRAINT (not just an index)
-- for onConflict resolution to work. This caused the "memory tool's conflict
-- specification" error in mavis-agent's save_memory tool.

-- Step 1: Remove duplicate rows, keeping the newest by id (UUID ordering is
-- effectively random; created_at doesn't exist on this table).
DELETE FROM public.mavis_persona_memory
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, key) id
  FROM public.mavis_persona_memory
  ORDER BY user_id, key, id DESC
);

-- Step 2: Drop the existing unnamed unique index so the constraint's backing
-- index doesn't conflict.
DROP INDEX IF EXISTS public.idx_persona_memory_user_key;

-- Step 3: Drop any previous partial run of this constraint.
ALTER TABLE public.mavis_persona_memory
  DROP CONSTRAINT IF EXISTS mavis_persona_memory_user_key_unique;

-- Step 4: Add the named UNIQUE CONSTRAINT (PostgREST onConflict requires this).
ALTER TABLE public.mavis_persona_memory
  ADD CONSTRAINT mavis_persona_memory_user_key_unique UNIQUE (user_id, key);
