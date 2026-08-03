DROP POLICY IF EXISTS "Insert messages for existing agent" ON public.customer_agent_messages;

CREATE POLICY "agent owner inserts messages"
ON public.customer_agent_messages
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.customer_agents ca
  WHERE ca.id = customer_agent_messages.agent_id
    AND ca.user_id = auth.uid()
));

REVOKE ALL ON FUNCTION public.seed_berkshire_council(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_berkshire_council(uuid) TO service_role;