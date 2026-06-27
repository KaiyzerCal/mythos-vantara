GRANT SELECT, INSERT, UPDATE, DELETE ON public.personas TO authenticated;
GRANT ALL ON public.personas TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_conversations TO authenticated;
GRANT ALL ON public.persona_conversations TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_states TO authenticated;
GRANT ALL ON public.relationship_states TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_memories TO authenticated;
GRANT ALL ON public.persona_memories TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavis_persona_memory TO authenticated;
GRANT ALL ON public.mavis_persona_memory TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavis_memory TO authenticated;
GRANT ALL ON public.mavis_memory TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_attachments TO authenticated;
GRANT ALL ON public.chat_attachments TO service_role;