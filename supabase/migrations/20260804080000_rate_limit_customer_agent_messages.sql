-- ============================================================
-- SECURITY FIX — rate-limit the public customer_agent_messages insert
-- ============================================================
-- customer_agent_messages has an intentionally public insert policy
-- (widget visitors aren't authenticated) with zero rate limiting at the
-- DB level. mavis-agent-serve's own write path already has an in-memory
-- per-agent limiter (40/min), but that only protects requests that go
-- through the edge function — any client can bypass it entirely by
-- POSTing straight to PostgREST with the anon key, since the RLS policy
-- itself allows any row through unconditionally. Unbounded growth /
-- spam vector, and a way to run up the agent owner's Claude API bill
-- indirectly if this table's inserts are ever used to trigger replies.
--
-- A trigger is used (not just the RLS policy) because RLS can't count
-- prior rows — SECURITY DEFINER is required for the trigger's own COUNT
-- query to see rows regardless of the inserting role, since the only
-- SELECT policy on this table is owner-only.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_customer_agent_message_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_count integer;
  agent_count   integer;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO session_count
  FROM customer_agent_messages
  WHERE agent_id = NEW.agent_id
    AND session_id = NEW.session_id
    AND ts > now() - interval '1 minute';
  IF session_count >= 30 THEN
    RAISE EXCEPTION 'Too many messages for this session — please wait a moment';
  END IF;

  SELECT count(*) INTO agent_count
  FROM customer_agent_messages
  WHERE agent_id = NEW.agent_id
    AND ts > now() - interval '1 minute';
  IF agent_count >= 200 THEN
    RAISE EXCEPTION 'This agent is receiving too many messages right now — please try again shortly';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_customer_agent_message_rate_limit_trigger ON public.customer_agent_messages;
CREATE TRIGGER enforce_customer_agent_message_rate_limit_trigger
BEFORE INSERT ON public.customer_agent_messages
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_agent_message_rate_limit();
