
-- Lock down whoop_tokens to service_role only (edge functions handle Whoop API)
DROP POLICY IF EXISTS "Users manage own whoop tokens" ON public.whoop_tokens;
REVOKE ALL ON public.whoop_tokens FROM authenticated, anon;
GRANT ALL ON public.whoop_tokens TO service_role;
CREATE POLICY "Service role only access" ON public.whoop_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Revoke EXECUTE on SECURITY DEFINER functions from signed-in users; only edge functions (service_role) should call them
REVOKE EXECUTE ON FUNCTION public.match_mavis_notes(vector, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_mavis_memories(vector, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mavis_log_cron_run(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_mavis_notes(vector, uuid, double precision, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_mavis_memories(vector, uuid, double precision, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mavis_log_cron_run(text, integer) TO service_role;
