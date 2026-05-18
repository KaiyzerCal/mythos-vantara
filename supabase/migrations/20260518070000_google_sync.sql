-- Add external_id column to tasks for Google Tasks bidirectional sync
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source text;
CREATE INDEX IF NOT EXISTS tasks_external_id_idx ON tasks(user_id, external_id) WHERE external_id IS NOT NULL;

-- pg_cron: Google Tasks sync at 09:00 UTC daily
SELECT cron.schedule('mavis-google-tasks-sync', '0 9 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-google-tasks-sync',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{"direction":"sync"}'::jsonb
  ) AS request_id$$);

-- pg_cron: GDrive sync at 06:00 UTC daily
SELECT cron.schedule('mavis-gdrive-sync', '0 6 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-gdrive-sync',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  ) AS request_id$$);
