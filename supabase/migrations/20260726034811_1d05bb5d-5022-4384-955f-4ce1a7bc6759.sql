
ALTER FUNCTION public.bump_memory_access(uuid) SET search_path = public;
ALTER FUNCTION public.consume_notification_slot(uuid) SET search_path = public;
ALTER FUNCTION public.decay_old_memories(uuid, integer) SET search_path = public;
ALTER FUNCTION public.increment_tool_usage(text) SET search_path = public;
ALTER FUNCTION public.increment_widget_usage(text, text) SET search_path = public;
ALTER FUNCTION public.match_documents(vector, uuid, integer, jsonb) SET search_path = public;
ALTER FUNCTION public.match_notebook_sources(vector, uuid, double precision, integer) SET search_path = public;
ALTER FUNCTION public.mavis_scrape_queue_set_updated() SET search_path = public;
ALTER FUNCTION public.mavis_social_queue_set_updated() SET search_path = public;
ALTER FUNCTION public.search_memories_hybrid(vector, text, uuid, integer) SET search_path = public;
ALTER FUNCTION public.search_memories_semantic(vector, uuid, integer) SET search_path = public;
ALTER FUNCTION public.set_ruview_updated_at() SET search_path = public;
ALTER FUNCTION public.touch_conversation_updated_at() SET search_path = public;
ALTER FUNCTION public.update_mavis_agent_config_updated_at() SET search_path = public;
