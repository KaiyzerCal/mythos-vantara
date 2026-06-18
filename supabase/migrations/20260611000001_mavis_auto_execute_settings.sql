-- Add auto_execute_types support via mavis_tacit
-- The task executor reads mavis_tacit rows with key='auto_execute_types'
-- and auto-promotes matching requires_confirmation tasks to 'approved'.

-- Ensure mavis_tacit category check allows 'standing_order' (already does).
-- No schema changes needed; this is documentation only.

-- For reference: to configure auto-execute for a user, insert/upsert:
--   INSERT INTO mavis_tacit (user_id, category, key, value, source)
--   VALUES (<uid>, 'standing_order', 'auto_execute_types',
--     '["daily_brief","memory_consolidation","revenue_snapshot","nora_tweet"]',
--     'system')
--   ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;

-- Also ensure email_reply is a valid task type handled by the executor.
-- No DB change required; the executor handles it via the HANDLERS map.

-- Add index on mavis_tasks(status, type) for faster executor polling
CREATE INDEX IF NOT EXISTS idx_mavis_tasks_status_type
  ON public.mavis_tasks(status, type);
