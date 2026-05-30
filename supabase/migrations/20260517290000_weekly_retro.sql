-- Cron: weekly retrospective every Sunday at 18:00 UTC
SELECT cron.schedule(
  'mavis-weekly-retro',
  '0 18 * * 0',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/mavis-weekly-retro',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- Also add mood column to journal_entries if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'mood'
  ) THEN
    ALTER TABLE journal_entries ADD COLUMN mood TEXT;
  END IF;
END $$;

-- Add tags column to journal_entries if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'tags'
  ) THEN
    ALTER TABLE journal_entries ADD COLUMN tags TEXT[] DEFAULT '{}';
  END IF;
END $$;
