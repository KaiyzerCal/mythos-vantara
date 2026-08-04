-- AgentDashboardPage's Autonomous Tasks and A2A Tasks tabs polled these
-- tables every 15s/20s on a dead setInterval loop instead of subscribing to
-- Realtime — enabling it here so the frontend fix (replacing the polling
-- with a postgres_changes subscription) actually has something to listen to.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mavis_autonomous_tasks;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mavis_a2a_tasks;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
