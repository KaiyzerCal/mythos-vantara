-- ── Register crons for previously orphaned functions ────────────────────────
-- mavis-compound-learning: consolidates interaction signals into operator prefs
-- mavis-self-improve: scores conversations and exports fine-tuning training pairs
-- Both run at 1am Sunday to stay out of the way of other weekly jobs.

SELECT cron.schedule(
  'mavis-compound-learning-weekly',
  '0 1 * * 0',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/mavis-compound-learning',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body := '{"trigger":"cron"}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'mavis-self-improve-weekly',
  '30 1 * * 0',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/mavis-self-improve',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body := '{"trigger":"cron"}'::jsonb
    );
  $$
);
