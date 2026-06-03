
-- Enable RLS on internal tables (service-role only, no policies = deny anon/authenticated)
ALTER TABLE public.mavis_autonomous_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavis_cron_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavis_memory_embed_queue ENABLE ROW LEVEL SECURITY;

-- Revoke API access from anon/authenticated; service_role bypasses RLS
REVOKE ALL ON public.mavis_autonomous_runs FROM anon, authenticated;
REVOKE ALL ON public.mavis_cron_config FROM anon, authenticated;
REVOKE ALL ON public.mavis_memory_embed_queue FROM anon, authenticated;
GRANT ALL ON public.mavis_autonomous_runs TO service_role;
GRANT ALL ON public.mavis_cron_config TO service_role;
GRANT ALL ON public.mavis_memory_embed_queue TO service_role;

-- Tighten website_projects policy: explicit authenticated role + WITH CHECK
DROP POLICY IF EXISTS "user own projects" ON public.website_projects;
CREATE POLICY "Users manage own website projects"
  ON public.website_projects
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Lock down SECURITY DEFINER functions that should only run from triggers/service-role
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.seed_default_workspaces() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.mavis_log_cron_run(text, integer) FROM anon, authenticated, public;

-- Restrict semantic search functions to authenticated users only
REVOKE EXECUTE ON FUNCTION public.match_mavis_notes(vector, uuid, double precision, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.search_mavis_memories(vector, uuid, double precision, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.match_mavis_notes(vector, uuid, double precision, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_mavis_memories(vector, uuid, double precision, integer) TO authenticated;

-- Restrict Realtime broadcasts to authenticated users on their own topics.
-- Convention: clients subscribe to topic = 'user:' || auth.uid()::text for private channels.
CREATE POLICY "Authenticated users read own realtime topics"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() LIKE ('user:' || auth.uid()::text || '%')
    OR realtime.topic() LIKE 'public:%'
  );

CREATE POLICY "Authenticated users write own realtime topics"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    realtime.topic() LIKE ('user:' || auth.uid()::text || '%')
  );
