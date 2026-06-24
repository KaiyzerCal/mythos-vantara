-- Register mavis-capability-audit in the cron config table.
-- mavis-cron-setup reads this table and schedules the job with pg_cron.
-- Schedule: every 6 hours (0:00, 6:00, 12:00, 18:00 UTC).

INSERT INTO mavis_cron_config (job_name, schedule, edge_function, payload, enabled)
VALUES (
  'mavis-capability-audit',
  '0 */6 * * *',
  'mavis-capability-audit',
  '{}',
  true
)
ON CONFLICT (job_name) DO UPDATE
  SET schedule      = EXCLUDED.schedule,
      edge_function = EXCLUDED.edge_function,
      payload       = EXCLUDED.payload,
      enabled       = EXCLUDED.enabled;
