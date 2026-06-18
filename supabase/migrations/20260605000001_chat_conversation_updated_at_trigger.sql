-- Keep chat_conversations.updated_at current whenever a message is inserted.
-- This ensures the mount-time query (ORDER BY updated_at DESC) always returns
-- the most recently ACTIVE conversation, not just the most recently CREATED one.

CREATE OR REPLACE FUNCTION public.touch_conversation_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.chat_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_touch_conversation ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_touch_conversation
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_updated_at();
