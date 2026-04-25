ALTER TABLE public.relationship_states REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.relationship_states;