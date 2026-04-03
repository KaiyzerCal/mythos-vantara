
CREATE TABLE public.council_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  council_member_id UUID NOT NULL REFERENCES public.councils(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user',
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.council_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own council chat messages"
ON public.council_chat_messages
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_council_chat_member ON public.council_chat_messages(council_member_id, created_at);
