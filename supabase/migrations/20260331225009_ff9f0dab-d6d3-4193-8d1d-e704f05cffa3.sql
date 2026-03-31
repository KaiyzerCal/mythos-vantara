-- Drop existing permissive ALL policy
DROP POLICY IF EXISTS "Users manage own messages" ON public.chat_messages;

-- SELECT: user can only read messages where user_id matches
CREATE POLICY "Users read own messages"
ON public.chat_messages
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- INSERT: user can only insert messages into conversations they own
CREATE POLICY "Users insert own messages"
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.chat_conversations cc
    WHERE cc.id = conversation_id AND cc.user_id = auth.uid()
  )
);

-- UPDATE: user can only update their own messages
CREATE POLICY "Users update own messages"
ON public.chat_messages
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- DELETE: user can only delete their own messages
CREATE POLICY "Users delete own messages"
ON public.chat_messages
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);