
-- Personas table: AI personas forged by users
CREATE TABLE public.personas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  archetype TEXT NOT NULL,
  personality JSONB NOT NULL DEFAULT '{}'::jsonb,
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  avatar_key TEXT,
  embodiment_endpoint TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own personas" ON public.personas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own personas" ON public.personas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own personas" ON public.personas FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own personas" ON public.personas FOR DELETE USING (auth.uid() = user_id);

-- Persona conversations: chat history per persona
CREATE TABLE public.persona_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id UUID NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_persona_conv_lookup ON public.persona_conversations(persona_id, user_id, created_at DESC);

ALTER TABLE public.persona_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own persona conversations" ON public.persona_conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own persona conversations" ON public.persona_conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own persona conversations" ON public.persona_conversations FOR DELETE USING (auth.uid() = user_id);

-- Relationship states: tracks bond/trust/mood per persona-user pair
CREATE TABLE public.relationship_states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id UUID NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  bond_level INTEGER NOT NULL DEFAULT 0,
  trust_level INTEGER NOT NULL DEFAULT 50,
  current_mood TEXT NOT NULL DEFAULT 'neutral',
  mood_reason TEXT,
  total_interactions INTEGER NOT NULL DEFAULT 0,
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (persona_id, user_id)
);

ALTER TABLE public.relationship_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own relationship states" ON public.relationship_states FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own relationship states" ON public.relationship_states FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own relationship states" ON public.relationship_states FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own relationship states" ON public.relationship_states FOR DELETE USING (auth.uid() = user_id);

-- Persona memories: long-term memories about the user, per persona
CREATE TABLE public.persona_memories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id UUID NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('episodic', 'semantic', 'emotional', 'preference')),
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_persona_mem_lookup ON public.persona_memories(persona_id, user_id, importance DESC);

ALTER TABLE public.persona_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own persona memories" ON public.persona_memories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own persona memories" ON public.persona_memories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own persona memories" ON public.persona_memories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own persona memories" ON public.persona_memories FOR DELETE USING (auth.uid() = user_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_persona_timestamps()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER personas_updated_at BEFORE UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.update_persona_timestamps();

CREATE TRIGGER relationship_states_updated_at BEFORE UPDATE ON public.relationship_states
  FOR EACH ROW EXECUTE FUNCTION public.update_persona_timestamps();
