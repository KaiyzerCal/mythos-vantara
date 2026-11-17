-- Applied live 2026-11-17 to cut always-on backend load (credits ran out 2026-11-16). ~2,225 -> ~810 runs/day.
-- Measured first: these jobs mostly returned "nothing to do" (0 processed / no active plans / nothing to embed).
-- Same jobs and commands, only the schedule changed. Re-runnable.
-- To revert a job: SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='<name>'), schedule := '<old>');
--   old: embed-backfill-5m, action-processor, ambient-monitor, autonomous-engine = '*/5 * * * *'
--        plan-executor-10m, trigger-engine, smoke-rolling-10m = '*/10 * * * *'
--        signal-watcher, emotion-sweep-15m, gmail-sync = '*/15 * * * *'; calendar-sync-30m = '*/30 * * * *'; post-meeting = '*/20 * * * *'
--        mavis-nora-engage was active (*/15) and errors every run until TWITTER_NORA_USER_ID / TWITTER_NORA_USERNAME is set.
SELECT cron.alter_job(j.jobid, schedule := v.s) FROM (VALUES
 ('mavis-embed-backfill-5m','*/15 * * * *'), ('mavis-action-processor','*/15 * * * *'), ('mavis-ambient-monitor','*/15 * * * *'),
 ('mavis-autonomous-engine','*/30 * * * *'), ('mavis-plan-executor-10m','*/30 * * * *'), ('mavis-trigger-engine','*/30 * * * *'),
 ('mavis-smoke-rolling-10m','*/30 * * * *'), ('mavis-signal-watcher','0 * * * *'), ('mavis-emotion-sweep-15m','*/30 * * * *'),
 ('mavis-gmail-sync','*/30 * * * *'), ('mavis-calendar-sync-30m','0 * * * *'), ('mavis-post-meeting','*/30 * * * *')
) AS v(n,s) JOIN cron.job j ON j.jobname = v.n;
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'mavis-nora-engage';
