-- Fix chat_messages SELECT policy so Telegram-originated messages
-- (written by the edge function with TELEGRAM_OPERATOR_USER_ID) are visible
-- to the conversation owner in the web UI.
--
-- Old policy: auth.uid() = user_id  ← blocks any message not written by this exact user
-- New policy: user owns the conversation ← correct; all messages in your thread are yours

DROP POLICY IF EXISTS "Users read own messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users read conversation messages" ON public.chat_messages;

CREATE POLICY "Users read conversation messages"
ON public.chat_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.chat_conversations cc
    WHERE cc.id = conversation_id
      AND cc.user_id = auth.uid()
  )
);
